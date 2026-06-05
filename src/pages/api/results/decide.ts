import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixture, type Wettbewerb } from '../../../lib/fixtures';
import { notifyConfirmed, notifyRejected } from '../../../lib/notify';

type ResultRow = {
  id: number;
  wettbewerb: string;
  gruppe: number | null;
  runde: string | null;
  match_nr: number;
  satz1: string;
  satz2: string;
  mtb: string | null;
  sieger: 'A' | 'B';
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
    .prepare(
      `SELECT id, wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, submitted_by
       FROM results WHERE id = ? AND status = 'pending'`,
    )
    .get(resultId) as ResultRow | undefined;
  if (!row) return redirect('/meine-spiele?error=gone');

  const fixture = findFixture(row.wettbewerb as Wettbewerb, { gruppe: row.gruppe, runde: row.runde, nr: row.match_nr });
  if (!fixture) return redirect('/meine-spiele?error=fixture');

  // Nur der Gegner darf entscheiden: eingeloggter Spieler muss auf der anderen
  // Seite stehen als der/die Eintragende — und nicht selbst eingetragen haben.
  const meOnA = fixture.sideA.includes(user.player_name);
  const meOnB = fixture.sideB.includes(user.player_name);
  if (!meOnA && !meOnB) return redirect('/meine-spiele?error=notyours');
  if (row.submitted_by === user.id) return redirect('/meine-spiele?error=ownresult');

  const submitter = row.submitted_by
    ? (db.prepare('SELECT player_name FROM users WHERE id = ?').get(row.submitted_by) as { player_name: string | null } | undefined)
    : undefined;
  const submitterName = submitter?.player_name ?? null;
  // Gegnerschaft prüfen: Eintragende:r und Bestätigende:r auf verschiedenen Seiten.
  if (submitterName) {
    const submitterOnA = fixture.sideA.includes(submitterName);
    const sameSide = (submitterOnA && meOnA) || (!submitterOnA && meOnB);
    if (sameSide) return redirect('/meine-spiele?error=ownresult');
  }

  const score = { satz1: row.satz1, satz2: row.satz2, mtb: row.mtb, sieger: row.sieger };
  const base = process.env.SITE_URL || new URL(request.url).origin;

  if (action === 'accept') {
    try {
      db.prepare("UPDATE results SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(user.id, row.id);
    } catch {
      return redirect('/meine-spiele?error=conflict');
    }
    await notifyConfirmed({ fixture, score });
    return redirect('/meine-spiele?decided=accepted');
  }

  db.prepare("UPDATE results SET status = 'rejected', reject_reason = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(reason, user.id, row.id);
  await notifyRejected({ base, fixture, score, submitterName, reason });
  return redirect('/meine-spiele?decided=rejected');
};
