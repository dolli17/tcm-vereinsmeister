// Benachrichtigungen rund um den Bestätigungs-Flow (Gegner & Admin).
import { getDb } from './db';
import { sendMail, mailLayout, button } from './mail';
import type { User } from './auth';
import type { FixtureRef } from './matchEntry';

type Score = { satz1: string | null; satz2: string | null; mtb: string | null; sieger: 'A' | 'B'; typ?: string };

const sideLabel = (names: string[]) => names.join(' / ');
const resultLine = (s: { satz1: string | null; satz2: string | null; mtb: string | null; typ?: string }) => {
  const base = [s.satz1, s.satz2, s.mtb].filter(Boolean).join(' · ');
  if (s.typ === 'wo') return 'kampflos (w.o.)';
  if (s.typ === 'aufgabe') return base ? `${base} · Aufgabe` : 'Aufgabe';
  return base;
};

function matchTitle(fixture: FixtureRef): string {
  const ctx = fixture.runde ?? (fixture.gruppe != null ? `Gruppe ${fixture.gruppe}` : '');
  return `${sideLabel(fixture.sideA)} vs ${sideLabel(fixture.sideB)}${ctx ? ` (${ctx})` : ''}`;
}

export function adminEmails(): string[] {
  const fromDb = (getDb().prepare("SELECT email FROM users WHERE role = 'admin'").all() as { email: string }[]).map((r) => r.email);
  if (fromDb.length > 0) return fromDb;
  return (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function emailsForNames(names: string[]): string[] {
  const db = getDb();
  const out: string[] = [];
  for (const name of names) {
    const rows = db.prepare("SELECT email FROM users WHERE player_name = ? AND claim_status = 'approved'").all(name) as { email: string }[];
    out.push(...rows.map((r) => r.email));
  }
  return Array.from(new Set(out));
}

// Informiert den Gegner per E-Mail, dass ein Ergebnis eingetragen wurde, und bittet
// ihn, sich einzuloggen und es unter „Meine Spiele" zu bestätigen oder abzulehnen.
// Ist niemand vom Gegnerteam registriert, wird der Admin zur manuellen Bestätigung informiert.
export async function notifyOpponent(opts: {
  base: string;
  submitter: User;
  fixture: FixtureRef;
  score: Score;
}): Promise<void> {
  const { base, submitter, fixture, score } = opts;
  const submitterOnA = submitter.player_name ? fixture.sideA.includes(submitter.player_name) : false;
  const oppNames = submitterOnA ? fixture.sideB : fixture.sideA;
  const winnerNames = score.sieger === 'A' ? fixture.sideA : fixture.sideB;

  const summary = `<p style="margin:0 0 6px"><strong>${matchTitle(fixture)}</strong></p>
    <p style="margin:0">Ergebnis: <strong>${resultLine(score)}</strong><br>Sieger: ${sideLabel(winnerNames)}</p>`;

  const oppEmails = emailsForNames(oppNames);
  if (oppEmails.length === 0) {
    await sendMail({
      to: adminEmails(),
      subject: 'Ergebnis wartet auf Bestätigung (kein registrierter Gegner)',
      html: mailLayout(
        'Manuelle Bestätigung nötig',
        `<p>${submitter.player_name} hat ein Ergebnis eingetragen, aber das Gegnerteam ist nicht registriert.</p>
         ${summary}
         <p>Bitte im Admin-Dashboard prüfen und bestätigen.</p>
         <p>${button(`${base}/admin`, 'Zum Admin-Dashboard')}</p>`,
      ),
    });
    return;
  }

  await sendMail({
    to: oppEmails,
    subject: `Ergebnis eingetragen: ${matchTitle(fixture)}`,
    html: mailLayout(
      'Ergebnis bestätigen',
      `<p>${submitter.player_name} hat ein Ergebnis für euer Spiel eingetragen:</p>
       ${summary}
       <p>Bitte logge dich ein und bestätige oder lehne das Ergebnis unter „Meine Spiele" ab.</p>
       <p>${button(`${base}/meine-spiele`, 'Zu Meine Spiele')}</p>
       <p style="font-size:12px;color:#8a8578">Erst nach deiner Bestätigung zählt das Ergebnis für die Tabelle.</p>`,
    ),
  });
}

// Beide Parteien über die Bestätigung informieren.
export async function notifyConfirmed(opts: { fixture: FixtureRef; score: Score }): Promise<void> {
  const { fixture, score } = opts;
  const emails = emailsForNames([...fixture.sideA, ...fixture.sideB]);
  if (emails.length === 0) return;
  const winnerNames = score.sieger === 'A' ? fixture.sideA : fixture.sideB;
  await sendMail({
    to: emails,
    subject: `Ergebnis bestätigt: ${matchTitle(fixture)}`,
    html: mailLayout(
      'Ergebnis bestätigt',
      `<p>Das Ergebnis wurde bestätigt und zählt jetzt für die Tabelle:</p>
       <p style="margin:0 0 6px"><strong>${matchTitle(fixture)}</strong></p>
       <p style="margin:0">Ergebnis: <strong>${resultLine(score)}</strong><br>Sieger: ${sideLabel(winnerNames)}</p>`,
    ),
  });
}

// Admin über eine Ablehnung benachrichtigen.
export async function notifyRejected(opts: {
  base: string;
  fixture: FixtureRef;
  score: Score;
  submitterName: string | null;
  reason: string | null;
}): Promise<void> {
  const { base, fixture, score, submitterName, reason } = opts;
  await sendMail({
    to: adminEmails(),
    subject: `Ergebnis abgelehnt: ${matchTitle(fixture)}`,
    html: mailLayout(
      'Ergebnis abgelehnt',
      `<p>Ein vom Gegner abgelehntes Ergebnis braucht deine Aufmerksamkeit:</p>
       <p style="margin:0 0 6px"><strong>${matchTitle(fixture)}</strong></p>
       <p style="margin:0">Eingetragen von: ${submitterName ?? '–'}<br>Ergebnis: ${resultLine(score)}</p>
       ${reason ? `<p>Begründung: <em>${reason}</em></p>` : ''}
       <p>${button(`${base}/admin`, 'Zum Admin-Dashboard')}</p>`,
    ),
  });
}
