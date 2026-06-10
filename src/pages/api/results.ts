import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { findFixtureById, flipSet, validateEntry } from '../../lib/matchEntry';
import { notifyOpponent } from '../../lib/notify';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') {
    return redirect('/meine-spiele?error=notapproved');
  }

  const form = await request.formData();
  const matchId = parseInt(String(form.get('match_id') ?? ''), 10);
  if (Number.isNaN(matchId)) return redirect('/meine-spiele?error=fixture');

  const fixture = findFixtureById(matchId);
  if (!fixture) return redirect('/meine-spiele?error=fixture');
  // Ergebnisse nur für die aktive Saison — archivierte Tabellen sind fix.
  if (fixture.seasonStatus !== 'aktiv') return redirect('/meine-spiele?error=archived');

  // Teilnahme serverseitig prüfen.
  const onA = fixture.sideA.includes(user.player_name);
  const onB = fixture.sideB.includes(user.player_name);
  if (!onA && !onB) return redirect('/meine-spiele?error=notyours');
  if (fixture.sideA.length === 0 || fixture.sideB.length === 0) return redirect('/meine-spiele?error=fixture');

  const db = getDb();
  // Es darf kein Ergebnis existieren, das bestätigt, in Bestätigung (pending) ODER
  // abgelehnt (in Admin-Klärung) ist.
  const blocking = db
    .prepare("SELECT status FROM results WHERE match_id = ? AND status IN ('confirmed','pending','rejected') LIMIT 1")
    .get(matchId) as { status: string } | undefined;
  if (blocking) {
    return redirect(`/meine-spiele?error=${blocking.status === 'rejected' ? 'inreview' : 'exists'}`);
  }

  // Sonderfälle (kampflos/Aufgabe): der Sieger kommt relativ zum Eintragenden
  // ('me'/'opp') und wird serverseitig auf Seite A/B gemappt. Sätze werden aus
  // Sicht des Eintragenden erfasst — steht er auf Seite B, wird gespiegelt
  // (gespeichert wird immer aus A-Sicht).
  const siegerRel = String(form.get('sieger_rel') ?? '');
  const meineSeite: 'A' | 'B' = onA ? 'A' : 'B';
  const andereSeite: 'A' | 'B' = onA ? 'B' : 'A';
  const flip = !onA;
  const s1 = String(form.get('satz1') ?? '');
  const s2 = String(form.get('satz2') ?? '');
  const mtb = String(form.get('mtb') ?? '');
  const valid = validateEntry({
    typ: String(form.get('ergebnis_typ') ?? 'gespielt'),
    satz1: flip ? flipSet(s1) : s1,
    satz2: flip ? flipSet(s2) : s2,
    mtb: flip ? flipSet(mtb) : mtb,
    sieger: siegerRel === 'me' ? meineSeite : siegerRel === 'opp' ? andereSeite : null,
  });
  if (!valid.ok) return redirect(`/meine-spiele?error=score`);

  db.prepare(
    `INSERT INTO results (match_id, wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, ergebnis_typ, status, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    matchId,
    fixture.wettbewerb,
    fixture.gruppe,
    fixture.runde,
    fixture.nr,
    valid.score.satz1,
    valid.score.satz2,
    valid.score.mtb,
    valid.score.sieger,
    valid.score.typ,
    user.id,
  );

  // Gegner per E-Mail informieren (best effort).
  const base = process.env.SITE_URL || new URL(request.url).origin;
  await notifyOpponent({ base, submitter: user, fixture, score: { ...valid.score, typ: valid.score.typ } });

  return redirect('/meine-spiele?entered=1');
};
