// Erinnerungs-Mails für offene/überfällige Spiele der aktiven Saison.
// Wird vom Cron (zeitfenster-gesteuert) und vom Admin-Button (force) genutzt.
import { getDb } from './db';
import { getActiveSeason, getCompetitions, getEnrichedMatches, monthIndex, teamPlayers } from './tournament';
import { sendMail, mailLayout, button } from './mail';

type DueMatch = {
  matchId: number;
  label: string;
  context: string;
  // Legacy-Schlüsselteile: reminders_sent aus der Fixtures-Ära ist mit
  // "wettbewerb|gruppe|runde|nr" verbucht — beim Dedupe mitprüfen.
  slug: string;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  sieger: 'A' | 'B' | null;
  dueNum: number | null;
  dueName: string | null;
};

function collectMatches(seasonId: number): DueMatch[] {
  const out: DueMatch[] = [];
  for (const comp of getCompetitions(seasonId)) {
    for (const m of getEnrichedMatches(comp.id)) {
      out.push({
        matchId: m.id,
        label: comp.name,
        context: m.gruppe != null ? `Gruppe ${m.gruppe}` : m.runde ?? '',
        slug: comp.slug,
        gruppe: m.gruppe,
        runde: m.runde,
        nr: m.nr,
        sideA: teamPlayers(m.sideA),
        sideB: teamPlayers(m.sideB),
        sieger: m.sieger,
        dueNum: m.monat ? monthIndex(m.monat) + 1 : null,
        dueName: m.monat ?? null,
      });
    }
  }
  return out;
}

export type ReminderResult = { cycle: string; matchesReminded: number; mailsSent: number; dry: boolean; skipped?: string };

// Versendet Erinnerungen an alle offenen, fälligen Spiele (dedupe pro Monatszyklus).
export async function runReminders(opts: { baseUrl: string; dry?: boolean }): Promise<ReminderResult> {
  const { baseUrl, dry = false } = opts;
  const now = new Date();
  const monthNum = now.getMonth() + 1;
  const cycle = `${now.getFullYear()}-${String(monthNum).padStart(2, '0')}`;

  const season = getActiveSeason();
  if (!season) return { cycle, matchesReminded: 0, mailsSent: 0, dry, skipped: 'keine aktive Saison' };
  // Mails nur im Kalenderjahr der Saison: danach soll die Saison archiviert
  // werden — sonst würde jeder Monatszyklus erneut alle offenen Spiele anmahnen.
  if (now.getFullYear() !== season.jahr) {
    return { cycle, matchesReminded: 0, mailsSent: 0, dry, skipped: `Saison ${season.jahr} liegt nicht im aktuellen Jahr` };
  }

  const db = getDb();
  const emailFor = db.prepare("SELECT email FROM users WHERE player_name = ? AND claim_status = 'approved'");
  const alreadySent = db.prepare('SELECT 1 FROM reminders_sent WHERE match_key = ? AND monat = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (match_key, monat) VALUES (?, ?)');
  // Spiele mit eingereichtem (pending) oder strittigem (rejected) Ergebnis sind
  // nicht "noch nicht gespielt" — keine Erinnerung, solange die Klärung läuft.
  const inProgress = new Set(
    (db
      .prepare("SELECT DISTINCT match_id FROM results WHERE status IN ('pending', 'rejected') AND match_id IS NOT NULL")
      .all() as { match_id: number }[]).map((r) => r.match_id),
  );

  let matches = 0;
  let mails = 0;

  for (const m of collectMatches(season.id)) {
    if (m.sieger === 'A' || m.sieger === 'B') continue;
    if (m.sideA.length === 0 || m.sideB.length === 0) continue;
    if (m.dueNum == null || m.dueNum > monthNum) continue;
    if (inProgress.has(m.matchId)) continue;
    const mk = String(m.matchId);
    const legacyKey = [m.slug, m.gruppe ?? '', m.runde ?? '', m.nr].join('|');
    if (alreadySent.get(mk, cycle) || alreadySent.get(legacyKey, cycle)) continue;

    const recipients: { email: string; name: string; opp: string }[] = [];
    for (const [side, other] of [[m.sideA, m.sideB], [m.sideB, m.sideA]] as [string[], string[]][]) {
      const oppLabel = other.join(' / ');
      for (const name of side) {
        for (const r of emailFor.all(name) as { email: string }[]) recipients.push({ email: r.email, name, opp: oppLabel });
      }
    }
    if (recipients.length === 0) continue;

    matches++;
    const fristTxt = m.dueNum < monthNum ? `war im ${m.dueName} fällig (überfällig)` : `ist im ${m.dueName} fällig`;
    if (!dry) {
      const sends = recipients.map((r) =>
        sendMail({
          to: r.email,
          subject: `Erinnerung: offenes Spiel (${m.label})`,
          html: mailLayout(
            'Spiel noch offen',
            `<p>Hallo ${r.name},</p>
             <p>dein Spiel gegen <strong>${r.opp}</strong> – ${m.label}, ${m.context} – ${fristTxt} und ist noch nicht gespielt.
             Bitte vereinbart zeitnah einen Termin und tragt das Ergebnis ein.</p>
             <p>${button(`${baseUrl}/meine-spiele`, 'Zu „Meine Spiele"')}</p>`,
          ),
        }),
      );
      const settled = await Promise.allSettled(sends);
      mails += settled.filter((s) => s.status === 'fulfilled').length;
      markSent.run(mk, cycle);
    } else {
      mails += recipients.length;
    }
  }

  return { cycle, matchesReminded: matches, mailsSent: mails, dry };
}
