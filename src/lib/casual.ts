// Privater Casual-/Head-to-Head-Bereich: lockere Duelle außerhalb der VM und
// die kombinierte Bilanz zweier Personen (Casual + bestätigte VM-Duelle aller Saisons).
import { getDb } from './db';
import { teamPlayers } from './tournament';
import { normalizeSetInput } from './matchEntry';

export type CasualMatch = {
  id: number;
  datum: string | null;
  player_a: string;
  player_b: string;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B';
  notiz: string | null;
  created_by: number | null;
  created_at: string;
};

function parseSet(s: string | null | undefined): { a: number; b: number } | null {
  const norm = normalizeSetInput(s);
  if (!norm) return null;
  const m = norm.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

export type CasualScoreInput = { satz1: string; satz2?: string | null; mtb?: string | null };
export type CasualScore = { satz1: string | null; satz2: string | null; mtb: string | null; sieger: 'A' | 'B' };

// Flexible Validierung: mind. 1 Satz; Sieger = mehr gewonnene Sätze (MTB zählt als Satz).
export function validateCasualScore(input: CasualScoreInput): { ok: true; score: CasualScore } | { ok: false; error: string } {
  const s1 = parseSet(input.satz1);
  if (!s1) return { ok: false, error: 'Bitte mindestens den ersten Satz im Format z. B. 6:3 eingeben.' };
  const s2 = parseSet(input.satz2);
  const mt = parseSet(input.mtb);

  let winsA = 0;
  let winsB = 0;
  for (const set of [s1, s2, mt]) {
    if (!set) continue;
    if (set.a > set.b) winsA += 1;
    else if (set.b > set.a) winsB += 1;
    else return { ok: false, error: 'Ein Satz darf nicht unentschieden sein.' };
  }
  if (winsA === winsB) return { ok: false, error: 'Das Ergebnis ergibt keinen eindeutigen Sieger.' };

  const norm = (set: { a: number; b: number } | null) => (set ? `${set.a}:${set.b}` : null);
  return { ok: true, score: { satz1: norm(s1), satz2: norm(s2), mtb: norm(mt), sieger: winsA > winsB ? 'A' : 'B' } };
}

export function listCasualMatches(limit = 200): CasualMatch[] {
  return getDb()
    .prepare('SELECT * FROM casual_matches ORDER BY COALESCE(datum, created_at) DESC, id DESC LIMIT ?')
    .all(limit) as CasualMatch[];
}

export function addCasualMatch(opts: {
  datum: string | null;
  playerA: string;
  playerB: string;
  score: CasualScore;
  notiz: string | null;
  createdBy: number;
}): void {
  const db = getDb();
  // Personen in den globalen Stamm aufnehmen (gemeinsamer Stamm mit der VM).
  for (const name of [opts.playerA, opts.playerB]) db.prepare('INSERT OR IGNORE INTO players (name) VALUES (?)').run(name);
  db.prepare(
    `INSERT INTO casual_matches (datum, player_a, player_b, satz1, satz2, mtb, sieger, notiz, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(opts.datum, opts.playerA, opts.playerB, opts.score.satz1, opts.score.satz2, opts.score.mtb, opts.score.sieger, opts.notiz, opts.createdBy);
}

// Löschen nur durch den Ersteller oder Admin — Casual-Daten anderer bleiben unantastbar.
export function deleteCasualMatch(id: number, user: { id: number; role: string }): boolean {
  const db = getDb();
  const res =
    user.role === 'admin'
      ? db.prepare('DELETE FROM casual_matches WHERE id = ?').run(id)
      : db.prepare('DELETE FROM casual_matches WHERE id = ? AND created_by = ?').run(id, user.id);
  return res.changes > 0;
}

export type Duel = {
  kind: 'VM' | 'Casual';
  context: string;
  datum: string | null;
  result: string;
  winner: string;
};

export type HeadToHead = {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  total: number;
  duels: Duel[];
};

const resultLine = (r: { satz1: string | null; satz2: string | null; mtb: string | null }) =>
  [r.satz1, r.satz2, r.mtb].filter(Boolean).join(' · ');

// Kombinierte Bilanz zweier Personen: bestätigte VM-Duelle (alle Saisons) + Casual.
export function headToHead(a: string, b: string): HeadToHead {
  const db = getDb();
  const duels: Duel[] = [];
  let aWins = 0;
  let bWins = 0;

  // VM: bestätigte Ergebnisse, bei denen a und b auf gegnerischen Seiten stehen.
  const vmRows = db
    .prepare(
      `SELECT r.satz1, r.satz2, r.mtb, r.sieger, m.side_a, m.side_b, m.gruppe, m.runde,
              c.name AS comp, s.jahr
       FROM results r
       JOIN matches m ON m.id = r.match_id
       JOIN competitions c ON c.id = m.competition_id
       JOIN seasons s ON s.id = c.season_id
       WHERE r.status = 'confirmed' AND r.match_id IS NOT NULL`,
    )
    .all() as {
    satz1: string | null; satz2: string | null; mtb: string | null; sieger: 'A' | 'B';
    side_a: string | null; side_b: string | null; gruppe: number | null; runde: string | null; comp: string; jahr: number;
  }[];

  for (const r of vmRows) {
    const sideA = teamPlayers(r.side_a);
    const sideB = teamPlayers(r.side_b);
    const aInA = sideA.includes(a);
    const aInB = sideB.includes(a);
    const bInA = sideA.includes(b);
    const bInB = sideB.includes(b);
    const opposed = (aInA && bInB) || (aInB && bInA);
    if (!opposed) continue;
    // Gewinner-Seite bestimmen, dann auf a/b mappen.
    const winnerSideHasA = (r.sieger === 'A' && aInA) || (r.sieger === 'B' && aInB);
    if (winnerSideHasA) aWins += 1;
    else bWins += 1;
    duels.push({
      kind: 'VM',
      context: `${r.comp} ${r.jahr}${r.gruppe != null ? ` · Gruppe ${r.gruppe}` : r.runde ? ` · ${r.runde}` : ''}`,
      datum: null,
      result: resultLine(r),
      winner: winnerSideHasA ? a : b,
    });
  }

  // Casual: Duelle zwischen a und b (in beliebiger Reihenfolge gespeichert).
  const casualRows = db
    .prepare(
      `SELECT * FROM casual_matches
       WHERE (player_a = ? AND player_b = ?) OR (player_a = ? AND player_b = ?)
       ORDER BY COALESCE(datum, created_at) DESC`,
    )
    .all(a, b, b, a) as CasualMatch[];

  for (const r of casualRows) {
    const winnerName = r.sieger === 'A' ? r.player_a : r.player_b;
    if (winnerName === a) aWins += 1;
    else if (winnerName === b) bWins += 1;
    duels.push({ kind: 'Casual', context: 'Casual', datum: r.datum, result: resultLine(r), winner: winnerName });
  }

  return { a, b, aWins, bWins, total: aWins + bWins, duels };
}
