import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixtureById, validateScore } from '../../../lib/matchEntry';
import { notifyConfirmed } from '../../../lib/notify';
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
    const old = db.prepare('SELECT match_id, satz1, satz2, mtb, status FROM results WHERE id = ?').get(resultId) as
      | { match_id: number | null; satz1: string; satz2: string; mtb: string | null; status: string }
      | undefined;
    db.prepare('DELETE FROM results WHERE id = ?').run(resultId);
    if (old) {
      if (old.match_id != null) syncBracketForMatch(old.match_id);
      logAction(admin, 'ergebnis_geloescht', `Match #${old.match_id ?? '?'}: ${[old.satz1, old.satz2, old.mtb].filter(Boolean).join(' · ')} (${old.status})`);
    }
    return redirect('/admin?ok=deleted');
  }

  const row = db
    .prepare('SELECT id, match_id, satz1, satz2, mtb, sieger, ergebnis_typ FROM results WHERE id = ?')
    .get(resultId) as ResultRow | undefined;
  if (!row) return redirect('/admin?error=1');

  // resolve: Admin trägt ein korrigiertes Ergebnis ein und bestätigt es final.
  let score = { satz1: row.satz1, satz2: row.satz2, mtb: row.mtb, sieger: row.sieger, typ: row.ergebnis_typ };
  if (action === 'resolve') {
    const valid = validateScore({ satz1: String(form.get('satz1') ?? ''), satz2: String(form.get('satz2') ?? ''), mtb: String(form.get('mtb') ?? '') });
    if (!valid.ok) return redirect('/admin?error=score');
    score = { ...valid.score, typ: 'gespielt' };
    db.prepare("UPDATE results SET satz1 = ?, satz2 = ?, mtb = ?, sieger = ?, ergebnis_typ = 'gespielt' WHERE id = ?").run(score.satz1, score.satz2, score.mtb, score.sieger, resultId);
  }

  try {
    db.prepare("UPDATE results SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(admin.id, resultId);
  } catch {
    return redirect('/admin?error=conflict');
  }

  if (row.match_id != null) syncBracketForMatch(row.match_id);
  const fixture = row.match_id != null ? findFixtureById(row.match_id) : null;
  const matchLabel = fixture ? `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}` : `Match #${row.match_id ?? '?'}`;
  logAction(admin, action === 'resolve' ? 'ergebnis_korrigiert' : 'ergebnis_bestaetigt', `${matchLabel} — ${[score.satz1, score.satz2, score.mtb].filter(Boolean).join(' · ')}`);
  if (fixture) await notifyConfirmed({ fixture, score });

  return redirect('/admin?ok=confirmed');
};
