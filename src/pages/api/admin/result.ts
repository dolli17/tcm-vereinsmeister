import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixture, type Wettbewerb } from '../../../lib/fixtures';
import { validateScore } from '../../../lib/matchEntry';
import { notifyConfirmed } from '../../../lib/notify';

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
};

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const resultId = parseInt(String(form.get('result_id') ?? ''), 10);
  const action = String(form.get('action') ?? '');
  if (Number.isNaN(resultId) || !['confirm', 'resolve', 'delete'].includes(action)) {
    return redirect('/admin?error=1');
  }

  const db = getDb();

  if (action === 'delete') {
    db.prepare('DELETE FROM results WHERE id = ?').run(resultId);
    return redirect('/admin?ok=deleted');
  }

  const row = db
    .prepare('SELECT id, wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger FROM results WHERE id = ?')
    .get(resultId) as ResultRow | undefined;
  if (!row) return redirect('/admin?error=1');

  // resolve: Admin trägt ein korrigiertes Ergebnis ein und bestätigt es final.
  let score = { satz1: row.satz1, satz2: row.satz2, mtb: row.mtb, sieger: row.sieger };
  if (action === 'resolve') {
    const valid = validateScore({ satz1: String(form.get('satz1') ?? ''), satz2: String(form.get('satz2') ?? ''), mtb: String(form.get('mtb') ?? '') });
    if (!valid.ok) return redirect('/admin?error=score');
    score = valid.score;
    db.prepare('UPDATE results SET satz1 = ?, satz2 = ?, mtb = ?, sieger = ? WHERE id = ?').run(score.satz1, score.satz2, score.mtb, score.sieger, resultId);
  }

  // confirm/resolve: final bestätigen (Klärung durch Admin, keine Rückgabe an Spieler).
  try {
    db.prepare("UPDATE results SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(admin.id, resultId);
  } catch {
    return redirect('/admin?error=conflict');
  }

  const fixture = findFixture(row.wettbewerb as Wettbewerb, { gruppe: row.gruppe, runde: row.runde, nr: row.match_nr });
  if (fixture) await notifyConfirmed({ fixture, score });

  return redirect('/admin?ok=confirmed');
};
