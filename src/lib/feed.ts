// Aktivitäts-Feed und "Demnächst auf dem Platz" für die Startseite. Beides aus
// öffentlichen Daten der Saison: bestätigte Ergebnisse und vereinbarte Termine.
import { getDb } from './db';
import { teamPlayers, type ErgebnisTyp, type Sieger } from './tournament';
import { formatResult } from './standings';

export type FeedEntry =
  | { typ: 'ergebnis'; zeit: string; comp: string; sieger: string; verlierer: string; result: string }
  | { typ: 'termin'; zeit: string; comp: string; sideA: string; sideB: string; termin: string };

type ResultRow = {
  zeit: string;
  comp: string;
  side_a: string | null;
  side_b: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: Sieger;
  ergebnis_typ: ErgebnisTyp;
};

// Gemischter Feed (neueste zuerst): bestätigte Ergebnisse + frisch vereinbarte
// (zukünftige) Termine. Freilose/Platzhalter fallen raus.
export function getActivityFeed(seasonId: number, limit = 8): FeedEntry[] {
  const db = getDb();
  const out: FeedEntry[] = [];

  const results = db
    .prepare(
      `SELECT COALESCE(r.decided_at, r.created_at) AS zeit, c.name AS comp,
              m.side_a, m.side_b, r.satz1, r.satz2, r.mtb, r.sieger, r.ergebnis_typ
       FROM results r
       JOIN matches m ON m.id = r.match_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE r.status = 'confirmed' AND c.season_id = ?
       ORDER BY zeit DESC LIMIT ?`,
    )
    .all(seasonId, limit) as ResultRow[];
  for (const r of results) {
    if (teamPlayers(r.side_a).length === 0 || teamPlayers(r.side_b).length === 0) continue;
    const sieger = r.sieger === 'A' ? r.side_a : r.side_b;
    const verlierer = r.sieger === 'A' ? r.side_b : r.side_a;
    if (!sieger || !verlierer) continue;
    out.push({
      typ: 'ergebnis',
      zeit: r.zeit,
      comp: r.comp,
      sieger,
      verlierer,
      result: formatResult({ satz1: r.satz1, satz2: r.satz2, mtb: r.mtb, sieger: r.sieger, ergebnisTyp: r.ergebnis_typ }),
    });
  }

  const termine = db
    .prepare(
      `SELECT p.created_at AS zeit, c.name AS comp, m.side_a, m.side_b, m.termin
       FROM termin_proposals p
       JOIN matches m ON m.id = p.match_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE p.status = 'accepted' AND c.season_id = ?
         AND m.termin IS NOT NULL AND REPLACE(m.termin, 'T', ' ') > datetime('now', 'localtime')
         AND NOT EXISTS (SELECT 1 FROM results r WHERE r.match_id = m.id AND r.status = 'confirmed')
       ORDER BY p.created_at DESC LIMIT ?`,
    )
    .all(seasonId, limit) as { zeit: string; comp: string; side_a: string | null; side_b: string | null; termin: string }[];
  for (const t of termine) {
    if (teamPlayers(t.side_a).length === 0 || teamPlayers(t.side_b).length === 0) continue;
    out.push({ typ: 'termin', zeit: t.zeit, comp: t.comp, sideA: t.side_a!, sideB: t.side_b!, termin: t.termin });
  }

  return out.sort((a, b) => b.zeit.localeCompare(a.zeit)).slice(0, limit);
}

export type UpcomingMatch = { comp: string; sideA: string; sideB: string; termin: string };

// Kommende terminierte Spiele ohne bestätigtes Ergebnis — "Demnächst auf dem Platz".
export function getUpcomingMatches(seasonId: number, limit = 5): UpcomingMatch[] {
  const rows = getDb()
    .prepare(
      `SELECT c.name AS comp, m.side_a, m.side_b, m.termin
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE c.season_id = ? AND m.termin IS NOT NULL AND REPLACE(m.termin, 'T', ' ') > datetime('now', 'localtime')
         AND NOT EXISTS (SELECT 1 FROM results r WHERE r.match_id = m.id AND r.status = 'confirmed')
       ORDER BY m.termin ASC LIMIT ?`,
    )
    .all(seasonId, limit * 2) as { comp: string; side_a: string | null; side_b: string | null; termin: string }[];
  return rows
    .filter((r) => teamPlayers(r.side_a).length > 0 && teamPlayers(r.side_b).length > 0)
    .slice(0, limit)
    .map((r) => ({ comp: r.comp, sideA: r.side_a!, sideB: r.side_b!, termin: r.termin }));
}

// Relative Zeitangabe für den Feed: "gerade eben", "vor 3 Std.", sonst "08.06.".
// SQLite-Zeitstempel (created_at/decided_at) sind UTC → als UTC parsen.
export function relTime(iso: string, now: Date = new Date()): string {
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(norm) ? norm : `${norm}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const tage = Math.floor(h / 24);
  if (tage === 1) return 'gestern';
  if (tage < 7) return `vor ${tage} Tagen`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}
