import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixtureById, validateEntry } from '../../../lib/matchEntry';
import { logAction } from '../../../lib/audit';
import { syncBracketForMatch } from '../../../lib/tournament';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const matchId = parseInt(String(form.get('match_id') ?? ''), 10);
  const action = String(form.get('action') ?? 'save');
  if (Number.isNaN(matchId)) return redirect('/admin/spiele?error=fixture');

  const fixture = findFixtureById(matchId);
  if (!fixture) return redirect('/admin/spiele?error=fixture');

  const db = getDb();

  const matchLabel = `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}`;

  if (action === 'delete') {
    db.prepare('DELETE FROM results WHERE match_id = ?').run(matchId);
    syncBracketForMatch(matchId);
    logAction(admin, 'ergebnis_geloescht', matchLabel);
    return redirect('/admin/spiele?ok=deleted');
  }

  const valid = validateEntry({
    typ: String(form.get('ergebnis_typ') ?? 'gespielt'),
    satz1: String(form.get('satz1') ?? ''),
    satz2: String(form.get('satz2') ?? ''),
    mtb: String(form.get('mtb') ?? ''),
    sieger: String(form.get('sieger') ?? ''),
  });
  if (!valid.ok) return redirect('/admin/spiele?error=score');
  const s = valid.score;

  // Admin-Eintrag ist maßgeblich: bestehende Datensätze dieses Spiels ersetzen.
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM results WHERE match_id = ?').run(matchId);
    db.prepare(
      `INSERT INTO results (match_id, wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, ergebnis_typ, status, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'))`,
    ).run(matchId, fixture.wettbewerb, fixture.gruppe, fixture.runde, fixture.nr, s.satz1, s.satz2, s.mtb, s.sieger, s.typ, admin.id);
  });
  tx();
  syncBracketForMatch(matchId);
  logAction(admin, 'ergebnis_eingetragen', `${matchLabel} — ${[s.satz1, s.satz2, s.mtb].filter(Boolean).join(' · ') || s.typ}`);

  return redirect('/admin/spiele?ok=saved');
};
