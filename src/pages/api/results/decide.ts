import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixtureById } from '../../../lib/matchEntry';
import { notifyConfirmed, notifyRejected } from '../../../lib/notify';
import { logAction } from '../../../lib/audit';
import { syncBracketForMatch } from '../../../lib/tournament';

type ResultRow = {
  id: number;
  match_id: number | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B';
  ergebnis_typ: string;
  submitted_by: number | null;
};

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/meine-spiele?error=notapproved');

  const form = await request.formData();
  const resultId = parseInt(String(form.get('result_id') ?? ''), 10);
  const action = String(form.get('action') ?? '');
  const reason = String(form.get('reason') ?? '').trim() || null;
  if (Number.isNaN(resultId) || !['accept', 'reject'].includes(action)) {
    return redirect('/meine-spiele?error=fixture');
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, match_id, satz1, satz2, mtb, sieger, ergebnis_typ, submitted_by FROM results WHERE id = ? AND status = 'pending'")
    .get(resultId) as ResultRow | undefined;
  if (!row) return redirect('/meine-spiele?error=gone');

  const fixture = row.match_id != null ? findFixtureById(row.match_id) : null;
  if (!fixture) return redirect('/meine-spiele?error=fixture');
  // Altlasten: pending Ergebnisse archivierter Saisons sind nicht mehr entscheidbar.
  if (fixture.seasonStatus !== 'aktiv') return redirect('/meine-spiele?error=archived');

  // Nur der Gegner darf entscheiden.
  const meOnA = fixture.sideA.includes(user.player_name);
  const meOnB = fixture.sideB.includes(user.player_name);
  if (!meOnA && !meOnB) return redirect('/meine-spiele?error=notyours');
  if (row.submitted_by === user.id) return redirect('/meine-spiele?error=ownresult');

  const submitter = row.submitted_by
    ? (db.prepare('SELECT player_name FROM users WHERE id = ?').get(row.submitted_by) as { player_name: string | null } | undefined)
    : undefined;
  const submitterName = submitter?.player_name ?? null;
  if (submitterName) {
    const submitterOnA = fixture.sideA.includes(submitterName);
    const sameSide = (submitterOnA && meOnA) || (!submitterOnA && meOnB);
    if (sameSide) return redirect('/meine-spiele?error=ownresult');
  }

  const score = { satz1: row.satz1, satz2: row.satz2, mtb: row.mtb, sieger: row.sieger, typ: row.ergebnis_typ };
  const base = process.env.SITE_URL || new URL(request.url).origin;

  if (action === 'accept') {
    try {
      db.prepare("UPDATE results SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(user.id, row.id);
    } catch {
      return redirect('/meine-spiele?error=conflict');
    }
    if (row.match_id != null) syncBracketForMatch(row.match_id);
    logAction(user, 'ergebnis_angenommen', `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')} — ${[score.satz1, score.satz2, score.mtb].filter(Boolean).join(' · ')}`);
    await notifyConfirmed({ fixture, score });
    return redirect('/meine-spiele?decided=accepted');
  }

  db.prepare("UPDATE results SET status = 'rejected', reject_reason = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(reason, user.id, row.id);
  logAction(user, 'ergebnis_abgelehnt', `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}${reason ? ` — Grund: ${reason}` : ''}`);
  await notifyRejected({ base, fixture, score, submitterName, reason });
  return redirect('/meine-spiele?decided=rejected');
};
