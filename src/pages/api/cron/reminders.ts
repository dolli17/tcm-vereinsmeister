import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { getEinzelMatches } from '../../../lib/results';
import { matchKey, type Konkurrenz } from '../../../lib/fixtures';
import { sendMail, mailLayout, button } from '../../../lib/mail';

// Turnier-Monate (JS-Monatsindex 0-11): Mai=4, Juni=5, Juli=6.
const MONTHS: Record<number, string> = { 4: 'Mai', 5: 'Juni', 6: 'Juli' };

// Per Cron (täglich) aufgerufen; sendet gegen Monatsende Erinnerungen für noch offene
// Einzel-Spiele des laufenden Monats. Geschützt per ?key=CRON_SECRET.
// ?force=1 ignoriert das Monatsende-Fenster, ?dry=1 sendet nicht (nur Zählung).
const handler: APIRoute = async ({ request, url }) => {
  const key = url.searchParams.get('key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const force = url.searchParams.get('force') === '1';
  const dry = url.searchParams.get('dry') === '1';

  const now = new Date();
  const monat = MONTHS[now.getMonth()];
  if (!monat) return Response.json({ skipped: 'kein Turniermonat', month: now.getMonth() + 1 });

  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!force && lastDay - now.getDate() > 6) {
    return Response.json({ skipped: 'nicht nah am Monatsende', tag: now.getDate(), monatsende: lastDay });
  }

  const db = getDb();
  const base = process.env.SITE_URL || new URL(request.url).origin;
  const emailFor = db.prepare("SELECT email FROM users WHERE player_name = ? AND claim_status = 'approved'");
  const alreadySent = db.prepare('SELECT 1 FROM reminders_sent WHERE match_key = ? AND monat = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (match_key, monat) VALUES (?, ?)');

  let matches = 0;
  let sent = 0;

  for (const konkurrenz of ['herren', 'damen'] as Konkurrenz[]) {
    for (const m of getEinzelMatches(konkurrenz)) {
      if (m.monat !== monat) continue;
      if (m.sieger === 'A' || m.sieger === 'B') continue; // schon gespielt
      const key2 = matchKey(konkurrenz, { gruppe: m.gruppe, nr: m.nr });
      if (alreadySent.get(key2, monat)) continue;

      const recipients: { email: string; name: string; opp: string }[] = [];
      for (const [name, opp] of [
        [m.spielerA, m.spielerB],
        [m.spielerB, m.spielerA],
      ] as [string, string][]) {
        for (const r of emailFor.all(name) as { email: string }[]) recipients.push({ email: r.email, name, opp });
      }
      if (recipients.length === 0) continue; // niemand registriert → nicht markieren, später erneut versuchen

      matches++;
      if (!dry) {
        for (const r of recipients) {
          await sendMail({
            to: r.email,
            subject: `Erinnerung: Dein Spiel im ${monat} ist noch offen`,
            html: mailLayout(
              'Spiel noch offen',
              `<p>Hallo ${r.name},</p>
               <p>dein Vereinsmeisterschafts-Spiel gegen <strong>${r.opp}</strong> (${monat}) ist noch nicht gespielt.
               Bitte vereinbart zeitnah einen Termin und tragt das Ergebnis ein.</p>
               <p>${button(`${base}/meine-spiele`, 'Zu „Meine Spiele"')}</p>`,
            ),
          });
          sent++;
        }
        markSent.run(key2, monat);
      } else {
        sent += recipients.length;
      }
    }
  }

  return Response.json({ monat, matchesReminded: matches, mailsSent: sent, dry });
};

export const GET = handler;
export const POST = handler;
