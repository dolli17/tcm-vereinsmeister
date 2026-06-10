// Terminvereinbarung: Vorschlag → Bestätigung durch die Gegenseite (analog zum
// Ergebnis-Flow). Angenommene Termine landen in matches.termin (ISO-Format).
import { getDb } from './db';

export type TerminProposal = {
  id: number;
  match_id: number;
  termin: string; // ISO 'YYYY-MM-DDTHH:MM'
  status: 'pending' | 'accepted' | 'declined' | 'superseded';
  proposed_by: number | null;
  proposer_name: string | null;
  created_at: string;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidTermin(t: string): boolean {
  return ISO_RE.test(t) && !Number.isNaN(new Date(t).getTime());
}

// Anzeige: "Sa, 14.06.2026 · 14:00"
export function formatTermin(t: string | null): string | null {
  if (!t) return null;
  if (!ISO_RE.test(t)) return t; // Altdaten (Freitext) unverändert anzeigen
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${wd}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Neuer Vorschlag ersetzt einen evtl. offenen Vorschlag desselben Spiels.
export function proposeTermin(matchId: number, termin: string, userId: number): TerminProposal {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE termin_proposals SET status = 'superseded' WHERE match_id = ? AND status = 'pending'").run(matchId);
    const id = db
      .prepare('INSERT INTO termin_proposals (match_id, termin, proposed_by) VALUES (?, ?, ?)')
      .run(matchId, termin, userId).lastInsertRowid as number;
    return id;
  });
  const id = tx();
  return getProposal(id)!;
}

export function getProposal(id: number): TerminProposal | null {
  return (
    (getDb()
      .prepare(
        `SELECT p.*, u.player_name AS proposer_name
         FROM termin_proposals p LEFT JOIN users u ON u.id = p.proposed_by
         WHERE p.id = ?`,
      )
      .get(id) as TerminProposal | undefined) ?? null
  );
}

// Offene Vorschläge je match_id (für "Meine Spiele").
export function getPendingProposals(): Map<number, TerminProposal> {
  const rows = getDb()
    .prepare(
      `SELECT p.*, u.player_name AS proposer_name
       FROM termin_proposals p LEFT JOIN users u ON u.id = p.proposed_by
       WHERE p.status = 'pending'`,
    )
    .all() as TerminProposal[];
  const map = new Map<number, TerminProposal>();
  for (const r of rows) map.set(r.match_id, r);
  return map;
}

// Entscheidung der Gegenseite; bei Annahme wird der Termin am Match gesetzt.
export function decideTermin(proposalId: number, userId: number, accept: boolean): TerminProposal | null {
  const db = getDb();
  const p = getProposal(proposalId);
  if (!p || p.status !== 'pending') return null;
  const tx = db.transaction(() => {
    db.prepare("UPDATE termin_proposals SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(
      accept ? 'accepted' : 'declined',
      userId,
      proposalId,
    );
    if (accept) db.prepare('UPDATE matches SET termin = ? WHERE id = ?').run(p.termin, p.match_id);
  });
  tx();
  return getProposal(proposalId);
}

// ICS-Kalendereintrag (90 Minuten) für einen vereinbarten Termin.
export function buildIcs(opts: { termin: string; title: string; description: string; uid: string }): string | null {
  if (!ISO_RE.test(opts.termin)) return null;
  const start = new Date(opts.termin);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  // Lokale "floating time" (ohne Z): der Termin gilt in lokaler Platzzeit.
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  };
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TC Muckensturm//Vereinsmeisterschaft//DE',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(opts.title)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
