import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { findFixture, type Wettbewerb } from '../../lib/fixtures';
import { validateScore } from '../../lib/matchEntry';
import { notifyOpponent } from '../../lib/notify';

const WETTBEWERBE: Wettbewerb[] = ['herren', 'damen', 'doppel', 'damen-doppel', 'mixed'];

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') {
    return redirect('/meine-spiele?error=notapproved');
  }

  const form = await request.formData();
  const wettbewerb = String(form.get('wettbewerb') ?? '') as Wettbewerb;
  const gruppeRaw = form.get('gruppe');
  const runde = (form.get('runde') as string) || null;
  const nr = parseInt(String(form.get('match_nr') ?? ''), 10);
  const gruppe = gruppeRaw != null && gruppeRaw !== '' ? parseInt(String(gruppeRaw), 10) : null;

  if (!WETTBEWERBE.includes(wettbewerb) || Number.isNaN(nr)) {
    return redirect('/meine-spiele?error=fixture');
  }

  const fixture = findFixture(wettbewerb, { gruppe, runde, nr });
  if (!fixture) return redirect('/meine-spiele?error=fixture');

  // Teilnahme serverseitig prüfen.
  const onA = fixture.sideA.includes(user.player_name);
  const onB = fixture.sideB.includes(user.player_name);
  if (!onA && !onB) return redirect('/meine-spiele?error=notyours');
  if (fixture.sideA.length === 0 || fixture.sideB.length === 0) return redirect('/meine-spiele?error=fixture');

  const db = getDb();
  // Es darf kein Ergebnis existieren, das bestätigt, in Bestätigung (pending) ODER
  // abgelehnt (in Admin-Klärung) ist — abgelehnte Partien gehen nicht zurück an Spieler.
  const blocking = db
    .prepare(
      `SELECT status FROM results
       WHERE wettbewerb = ? AND IFNULL(gruppe,-1) = IFNULL(?,-1) AND IFNULL(runde,'') = IFNULL(?,'')
         AND match_nr = ? AND status IN ('confirmed','pending','rejected') LIMIT 1`,
    )
    .get(wettbewerb, gruppe, runde, nr) as { status: string } | undefined;
  if (blocking) {
    return redirect(`/meine-spiele?error=${blocking.status === 'rejected' ? 'inreview' : 'exists'}`);
  }

  const valid = validateScore({
    satz1: String(form.get('satz1') ?? ''),
    satz2: String(form.get('satz2') ?? ''),
    mtb: String(form.get('mtb') ?? ''),
  });
  if (!valid.ok) return redirect(`/meine-spiele?error=score`);

  db.prepare(
    `INSERT INTO results (wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, status, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(wettbewerb, gruppe, runde, nr, valid.score.satz1, valid.score.satz2, valid.score.mtb, valid.score.sieger, user.id);

  // Gegner per E-Mail informieren (best effort).
  const base = process.env.SITE_URL || new URL(request.url).origin;
  await notifyOpponent({ base, submitter: user, fixture, score: valid.score });

  return redirect('/meine-spiele?entered=1');
};
