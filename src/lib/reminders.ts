// Erinnerungs-Mails: VM-Spiele werden NICHT mehr automatisch angemahnt — der
// Admin erinnert gezielt pro überfälligem Spiel (remindMatch, Button im
// Dashboard). Nur die Forderungslisten-Fristen laufen weiter täglich per Cron.
import { getDb } from './db';
import { sendMail, mailLayout, button } from './mail';
import { adminEmails, emailsForNames } from './notify';
import { findFixtureById } from './matchEntry';
import { fmtDatum, type Challenge } from './ladder';

export type RemindMatchResult = { ok: true; mails: number } | { ok: false; error: string };

// Erinnerungs-Mail für EIN Spiel an alle registrierten Beteiligten (Admin-Klick).
export async function remindMatch(matchId: number, baseUrl: string): Promise<RemindMatchResult> {
  const fixture = findFixtureById(matchId);
  if (!fixture) return { ok: false, error: 'fixture' };
  if (fixture.sideA.length === 0 || fixture.sideB.length === 0) return { ok: false, error: 'fixture' };

  const monat = (getDb().prepare('SELECT monat FROM matches WHERE id = ?').get(matchId) as { monat: string | null } | undefined)
    ?.monat;
  const fristTxt = monat ? ` Es war im ${monat} fällig.` : '';

  const emailFor = getDb().prepare("SELECT email FROM users WHERE player_name = ? AND claim_status = 'approved'");
  const recipients: { email: string; name: string; opp: string }[] = [];
  for (const [side, other] of [[fixture.sideA, fixture.sideB], [fixture.sideB, fixture.sideA]] as [string[], string[]][]) {
    const oppLabel = other.join(' / ');
    for (const name of side) {
      for (const r of emailFor.all(name) as { email: string }[]) recipients.push({ email: r.email, name, opp: oppLabel });
    }
  }
  if (recipients.length === 0) return { ok: false, error: 'keine_accounts' };

  const sends = recipients.map((r) =>
    sendMail({
      to: r.email,
      subject: `Erinnerung: offenes Spiel (${fixture.wettbewerbLabel})`,
      html: mailLayout(
        'Spiel noch offen',
        `<p>Hallo ${r.name},</p>
         <p>dein Spiel gegen <strong>${r.opp}</strong> – ${fixture.wettbewerbLabel}${
           fixture.gruppe != null ? `, Gruppe ${fixture.gruppe}` : fixture.runde ? `, ${fixture.runde}` : ''
         } – ist noch nicht gespielt.${fristTxt}
         Bitte vereinbart zeitnah einen Termin und tragt das Ergebnis ein.</p>
         <p>${button(`${baseUrl}/meine-spiele`, 'Zu „Meine Spiele"')}</p>`,
      ),
    }),
  );
  const settled = await Promise.allSettled(sends);
  return { ok: true, mails: settled.filter((s) => s.status === 'fulfilled').length };
}

// ── Forderungsliste: Frist-Erinnerung + Ablauf-Info (täglich) ────────────────
export type LadderReminderResult = { warned: number; expired: number; dry: boolean };

// Einmal-Versand pro Forderung über reminders_sent (match_key = 'ladder:<id>:…').
export async function runLadderReminders(opts: { baseUrl: string; dry?: boolean }): Promise<LadderReminderResult> {
  const { baseUrl, dry = false } = opts;
  const db = getDb();
  const alreadySent = db.prepare('SELECT 1 FROM reminders_sent WHERE match_key = ? AND monat = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (match_key, monat) VALUES (?, ?)');
  const ONCE = 'einmalig';

  let warned = 0;
  let expired = 0;

  // 1) Fristerinnerung: 7 Tage vor Ablauf der 14-Tage-Frist an beide Beteiligte.
  const warnRows = db
    .prepare(
      `SELECT * FROM challenges
       WHERE status IN ('offen','ergebnis_pending')
         AND deadline >= datetime('now') AND deadline <= datetime('now', '+7 days')`,
    )
    .all() as Challenge[];
  for (const c of warnRows) {
    const key = `ladder:${c.id}:warn`;
    if (alreadySent.get(key, ONCE)) continue;
    warned++;
    if (dry) continue;
    const emails = emailsForNames([c.challenger, c.challenged]);
    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: `Forderung läuft ab: ${c.challenger} vs ${c.challenged}`,
        html: mailLayout(
          'Forderung bald fällig',
          `<p>Die Forderung <strong>${c.challenger}</strong> gegen <strong>${c.challenged}</strong>
           (Forderungsliste ${c.liste === 'herren' ? 'Herren' : 'Damen'}) muss bis zum
           <strong>${fmtDatum(c.deadline)}</strong> gespielt sein.</p>
           <p>Bitte vereinbart zeitnah einen Termin und tragt das Ergebnis ein.</p>
           <p>${button(`${baseUrl}/forderung`, 'Zur Forderungsliste')}</p>`,
        ),
      });
    }
    markSent.run(key, ONCE);
  }

  // 2) Ablauf-Info an den Ranglistenbetreuer (Admin) zur Wertung.
  const expiredRows = db
    .prepare(
      `SELECT * FROM challenges
       WHERE status IN ('offen','ergebnis_pending') AND deadline < datetime('now')`,
    )
    .all() as Challenge[];
  for (const c of expiredRows) {
    const key = `ladder:${c.id}:expired`;
    if (alreadySent.get(key, ONCE)) continue;
    expired++;
    if (dry) continue;
    await sendMail({
      to: adminEmails(),
      subject: `Forderung abgelaufen: ${c.challenger} vs ${c.challenged}`,
      html: mailLayout(
        'Forderung abgelaufen',
        `<p>Die 14-Tage-Frist der Forderung <strong>${c.challenger}</strong> gegen
         <strong>${c.challenged}</strong> (Liste ${c.liste === 'herren' ? 'Herren' : 'Damen'}) ist am
         ${fmtDatum(c.deadline)} abgelaufen, ohne dass ein Ergebnis bestätigt wurde.</p>
         <p>Bitte im Admin-Bereich werten (kampflos für eine Seite oder verfallen lassen).</p>
         <p>${button(`${baseUrl}/admin/forderung`, 'Zur Forderungs-Verwaltung')}</p>`,
      ),
    });
    markSent.run(key, ONCE);
  }

  return { warned, expired, dry };
}
