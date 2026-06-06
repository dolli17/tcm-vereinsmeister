import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { getEinzelMatches, getDoppelMatches, getMixedMatches } from '../../../lib/results';
import { matchKey, teamPlayers, type Wettbewerb } from '../../../lib/fixtures';
import { sendMail, mailLayout, button } from '../../../lib/mail';

// Turniermonate (Kalendermonat): Mai=5, Juni=6, Juli=7.
const NAME2NUM: Record<string, number> = { Mai: 5, Juni: 6, Juli: 7 };
const NUM2NAME: Record<number, string> = { 5: 'Mai', 6: 'Juni', 7: 'Juli' };
const WLABEL: Record<Wettbewerb, string> = {
  herren: 'Herren Einzel', damen: 'Damen Einzel', doppel: 'Herren Doppel', 'damen-doppel': 'Damen Doppel', mixed: 'Mixed Doppel',
};

type DueMatch = {
  wettbewerb: Wettbewerb;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  sieger: 'A' | 'B' | null;
  dueNum: number | null; // Fälligkeits-Monat als Zahl (null = keine Frist)
  context: string;
};

// Sammelt ALLE Spiele aller Konkurrenzen mit ihrem Fälligkeits-Monat.
function collectMatches(): DueMatch[] {
  const out: DueMatch[] = [];
  // Einzel: Monat steht am Match.
  for (const k of ['herren', 'damen'] as const) {
    for (const m of getEinzelMatches(k)) {
      out.push({
        wettbewerb: k, gruppe: m.gruppe, runde: null, nr: m.nr,
        sideA: [m.spielerA], sideB: [m.spielerB], sieger: m.sieger,
        dueNum: NAME2NUM[m.monat] ?? null, context: `Gruppe ${m.gruppe}`,
      });
    }
  }
  // Doppel/Mixed: 1. Runde ist im Mai fällig; spätere Runden ohne feste Frist.
  const dueOfRound = (runde: string) => (runde === '1. Runde' ? 5 : null);
  for (const w of ['doppel', 'damen-doppel'] as const) {
    for (const m of getDoppelMatches(w)) {
      out.push({
        wettbewerb: w, gruppe: null, runde: m.runde, nr: m.nr,
        sideA: teamPlayers(m.doppelA), sideB: teamPlayers(m.doppelB), sieger: m.sieger,
        dueNum: dueOfRound(m.runde), context: m.runde,
      });
    }
  }
  for (const m of getMixedMatches()) {
    out.push({
      wettbewerb: 'mixed', gruppe: null, runde: m.runde, nr: m.nr,
      sideA: teamPlayers(m.teamA), sideB: teamPlayers(m.teamB), sieger: m.sieger,
      dueNum: dueOfRound(m.runde), context: m.runde,
    });
  }
  return out;
}

// Per Cron (täglich) aufgerufen; erinnert gegen Monatsende an ALLE offenen Spiele,
// deren Frist im laufenden Monat oder bereits davor lag (überfällige inklusive).
// Geschützt per ?key=CRON_SECRET. ?force=1 ignoriert das Fenster, ?dry=1 sendet nicht.
const handler: APIRoute = async ({ request, url }) => {
  const key = url.searchParams.get('key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const force = url.searchParams.get('force') === '1';
  const dry = url.searchParams.get('dry') === '1';

  const now = new Date();
  const monthNum = now.getMonth() + 1;
  if (!NUM2NAME[monthNum]) return Response.json({ skipped: 'kein Turniermonat', month: monthNum });

  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!force && lastDay - now.getDate() > 6) {
    return Response.json({ skipped: 'nicht nah am Monatsende', tag: now.getDate(), monatsende: lastDay });
  }

  // Dedupe-Schlüssel pro Erinnerungs-Zyklus (Jahr-Monat) → jedes offene Spiel wird
  // einmal pro Monatsende-Zyklus erinnert, auch überfällige immer wieder.
  const cycle = `${now.getFullYear()}-${String(monthNum).padStart(2, '0')}`;

  const db = getDb();
  const base = process.env.SITE_URL || new URL(request.url).origin;
  const emailFor = db.prepare("SELECT email FROM users WHERE player_name = ? AND claim_status = 'approved'");
  const alreadySent = db.prepare('SELECT 1 FROM reminders_sent WHERE match_key = ? AND monat = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (match_key, monat) VALUES (?, ?)');

  let matches = 0;
  let mails = 0;

  for (const m of collectMatches()) {
    if (m.sieger === 'A' || m.sieger === 'B') continue;           // bereits gespielt
    if (m.sideA.length === 0 || m.sideB.length === 0) continue;   // Freilos / Platzhalter
    if (m.dueNum == null || m.dueNum > monthNum) continue;        // noch nicht fällig
    const mk = matchKey(m.wettbewerb, { gruppe: m.gruppe, runde: m.runde, nr: m.nr });
    if (alreadySent.get(mk, cycle)) continue;

    const recipients: { email: string; name: string; opp: string }[] = [];
    for (const [side, other] of [[m.sideA, m.sideB], [m.sideB, m.sideA]] as [string[], string[]][]) {
      const oppLabel = other.join(' / ');
      for (const name of side) {
        for (const r of emailFor.all(name) as { email: string }[]) recipients.push({ email: r.email, name, opp: oppLabel });
      }
    }
    if (recipients.length === 0) continue; // niemand registriert → nicht markieren

    matches++;
    const fristTxt = m.dueNum < monthNum ? `war im ${NUM2NAME[m.dueNum]} fällig (überfällig)` : `ist im ${NUM2NAME[m.dueNum]} fällig`;
    if (!dry) {
      for (const r of recipients) {
        await sendMail({
          to: r.email,
          subject: `Erinnerung: offenes Spiel (${WLABEL[m.wettbewerb]})`,
          html: mailLayout(
            'Spiel noch offen',
            `<p>Hallo ${r.name},</p>
             <p>dein Spiel gegen <strong>${r.opp}</strong> – ${WLABEL[m.wettbewerb]}, ${m.context} – ${fristTxt} und ist noch nicht gespielt.
             Bitte vereinbart zeitnah einen Termin und tragt das Ergebnis ein.</p>
             <p>${button(`${base}/meine-spiele`, 'Zu „Meine Spiele"')}</p>`,
          ),
        });
        mails++;
      }
      markSent.run(mk, cycle);
    } else {
      mails += recipients.length;
    }
  }

  return Response.json({ cycle, matchesReminded: matches, mailsSent: mails, dry });
};

export const GET = handler;
export const POST = handler;
