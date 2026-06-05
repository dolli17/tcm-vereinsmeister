import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findFixture, type Wettbewerb } from '../../../lib/fixtures';
import { validateScore } from '../../../lib/matchEntry';

const WETTBEWERBE: Wettbewerb[] = ['herren', 'damen', 'doppel', 'damen-doppel', 'mixed'];

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const wettbewerb = String(form.get('wettbewerb') ?? '') as Wettbewerb;
  const gruppeRaw = form.get('gruppe');
  const runde = (form.get('runde') as string) || null;
  const nr = parseInt(String(form.get('match_nr') ?? ''), 10);
  const gruppe = gruppeRaw != null && gruppeRaw !== '' ? parseInt(String(gruppeRaw), 10) : null;
  const action = String(form.get('action') ?? 'save');

  if (!WETTBEWERBE.includes(wettbewerb) || Number.isNaN(nr)) return redirect('/admin/spiele?error=fixture');
  const fixture = findFixture(wettbewerb, { gruppe, runde, nr });
  if (!fixture) return redirect('/admin/spiele?error=fixture');

  const db = getDb();
  const matchWhere = `wettbewerb = ? AND IFNULL(gruppe,-1) = IFNULL(?,-1) AND IFNULL(runde,'') = IFNULL(?,'') AND match_nr = ?`;

  if (action === 'delete') {
    db.prepare(`DELETE FROM results WHERE ${matchWhere}`).run(wettbewerb, gruppe, runde, nr);
    return redirect('/admin/spiele?ok=deleted');
  }

  const valid = validateScore({ satz1: String(form.get('satz1') ?? ''), satz2: String(form.get('satz2') ?? ''), mtb: String(form.get('mtb') ?? '') });
  if (!valid.ok) return redirect('/admin/spiele?error=score');
  const s = valid.score;

  // Admin-Eintrag ist maßgeblich: bestehende Datensätze dieses Spiels ersetzen.
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM results WHERE ${matchWhere}`).run(wettbewerb, gruppe, runde, nr);
    db.prepare(
      `INSERT INTO results (wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, status, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'))`,
    ).run(wettbewerb, gruppe, runde, nr, s.satz1, s.satz2, s.mtb, s.sieger, admin.id);
  });
  tx();

  return redirect('/admin/spiele?ok=saved');
};
