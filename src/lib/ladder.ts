// Forderungsrangliste nach dem Tannenbaum-System (TBS, tannenbaumsystem-2015.pdf).
// Die Liste ist eine Pyramide: Reihe r hat r Plätze. Reihe/Spalte werden IMMER
// aus dem Rang berechnet und nie gespeichert. Sieg des Forderers = Einfüge-
// Kaskade (kein Tausch), Niederlage = 7 Tage Forderungssperre, Sieger 2 Tage
// geschützt. Frist je Forderung: 14 Tage.
import { getDb } from './db';
import { flipSet, validateEntry, type EntryScore } from './matchEntry';

export type Liste = 'herren' | 'damen';
export const LISTEN: Liste[] = ['herren', 'damen'];
export function isListe(x: string): x is Liste {
  return x === 'herren' || x === 'damen';
}

// ── Pyramiden-Geometrie (1-basierte Ränge) ──────────────────────────────────
export function rowStart(r: number): number {
  return ((r - 1) * r) / 2 + 1;
}
export function rowEnd(r: number): number {
  return (r * (r + 1)) / 2;
}
export function reiheVonRang(p: number): number {
  let r = 1;
  while (rowEnd(r) < p) r++;
  return r;
}
export function indexVonRang(p: number): number {
  return p - rowStart(reiheVonRang(p));
}

// Forderbare Gegner für Rang p bei `anzahl` besetzten Plätzen:
//  1. eigene Reihe, alle links (besser platziert),
//  2. Reihe darüber ab der eigenen Spalte nach rechts,
//  3. Sonderregel: Rang 3 darf zusätzlich Rang 1 fordern,
//  4. bei > 36 Teilnehmern dürfen Spieler unterhalb der vollen Pyramide (Rang > 36)
//     die gesamte Reihe darüber fordern.
export function forderbareGegner(p: number, anzahl: number): number[] {
  if (p <= 1 || p > anzahl) return [];
  const r = reiheVonRang(p);
  const i = indexVonRang(p);
  const set = new Set<number>();

  for (let q = rowStart(r); q < p; q++) set.add(q);

  if (r > 1) {
    const fullRowAbove = anzahl > 36 && p > 36;
    const start = fullRowAbove ? rowStart(r - 1) : rowStart(r - 1) + i;
    for (let q = start; q <= rowEnd(r - 1); q++) set.add(q);
  }

  if (p === 3) set.add(1);

  return Array.from(set)
    .filter((q) => q >= 1 && q <= anzahl && q !== p)
    .sort((a, b) => a - b);
}

// ── Typen ────────────────────────────────────────────────────────────────────
export type LadderEntry = {
  id: number;
  liste: Liste;
  player_name: string;
  rank: number;
  gesperrt_bis: string | null;
  geschuetzt_bis: string | null;
  created_at: string;
};

export type ChallengeStatus = 'offen' | 'ergebnis_pending' | 'gespielt' | 'kampflos' | 'verfallen' | 'zurueckgezogen';

export type Challenge = {
  id: number;
  liste: Liste;
  saison: number;
  challenger: string;
  challenged: string;
  status: ChallengeStatus;
  deadline: string;
  termin: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  ergebnis_typ: string;
  sieger: 'challenger' | 'challenged' | null;
  eingetragen_von: number | null;
  created_at: string;
  decided_at: string | null;
  decided_by: number | null;
};

type Result<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

// ── Listen-Zugriff ───────────────────────────────────────────────────────────
export function getLadderEntries(liste: Liste): LadderEntry[] {
  return getDb().prepare('SELECT * FROM ladder_players WHERE liste = ? ORDER BY rank').all(liste) as LadderEntry[];
}

export function getLadderEntry(liste: Liste, name: string): LadderEntry | null {
  return (
    (getDb().prepare('SELECT * FROM ladder_players WHERE liste = ? AND player_name = ?').get(liste, name) as
      | LadderEntry
      | undefined) ?? null
  );
}

export function getOpenChallenges(liste: Liste): Challenge[] {
  return getDb()
    .prepare("SELECT * FROM challenges WHERE liste = ? AND status IN ('offen','ergebnis_pending') ORDER BY created_at")
    .all(liste) as Challenge[];
}

export function getChallenge(id: number): Challenge | null {
  return ((getDb().prepare('SELECT * FROM challenges WHERE id = ?').get(id) as Challenge | undefined) ?? null);
}

function hatOffeneForderung(liste: Liste, name: string): boolean {
  return !!getDb()
    .prepare(
      "SELECT 1 FROM challenges WHERE liste = ? AND status IN ('offen','ergebnis_pending') AND (challenger = ? OR challenged = ?)",
    )
    .get(liste, name, name);
}

// Lücken schließen: Ränge fortlaufend 1..n in bestehender Reihenfolge.
function normalizeRanks(liste: Liste): void {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM ladder_players WHERE liste = ? ORDER BY rank').all(liste) as { id: number }[];
  const upd = db.prepare('UPDATE ladder_players SET rank = ? WHERE id = ?');
  rows.forEach((row, idx) => upd.run(idx + 1, row.id));
}

export function joinLadder(liste: Liste, name: string): Result {
  const db = getDb();
  if (getLadderEntry(liste, name)) return { ok: false, error: 'schon_drauf' };
  const max = (db.prepare('SELECT COALESCE(MAX(rank), 0) AS m FROM ladder_players WHERE liste = ?').get(liste) as { m: number }).m;
  db.prepare('INSERT INTO ladder_players (liste, player_name, rank) VALUES (?, ?, ?)').run(liste, name, max + 1);
  return { ok: true };
}

export function leaveLadder(liste: Liste, name: string): Result {
  const db = getDb();
  if (!getLadderEntry(liste, name)) return { ok: false, error: 'nicht_drauf' };
  if (hatOffeneForderung(liste, name)) return { ok: false, error: 'offene_forderung' };
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ladder_players WHERE liste = ? AND player_name = ?').run(liste, name);
    normalizeRanks(liste);
  });
  tx();
  return { ok: true };
}

// Admin: Spieler an einer bestimmten Position einsortieren (Regel 6).
export function insertAtRank(liste: Liste, name: string, rank: number): Result {
  const db = getDb();
  if (getLadderEntry(liste, name)) return { ok: false, error: 'schon_drauf' };
  const n = getLadderEntries(liste).length;
  const pos = Math.max(1, Math.min(rank, n + 1));
  const tx = db.transaction(() => {
    db.prepare('UPDATE ladder_players SET rank = rank + 1 WHERE liste = ? AND rank >= ?').run(liste, pos);
    db.prepare('INSERT INTO ladder_players (liste, player_name, rank) VALUES (?, ?, ?)').run(liste, name, pos);
  });
  tx();
  return { ok: true };
}

// Admin: einen Platz nach oben/unten (Feinjustage der Startreihenfolge).
export function moveEntry(liste: Liste, name: string, dir: 'up' | 'down'): Result {
  const db = getDb();
  const entry = getLadderEntry(liste, name);
  if (!entry) return { ok: false, error: 'nicht_drauf' };
  const targetRank = dir === 'up' ? entry.rank - 1 : entry.rank + 1;
  const neighbor = db
    .prepare('SELECT * FROM ladder_players WHERE liste = ? AND rank = ?')
    .get(liste, targetRank) as LadderEntry | undefined;
  if (!neighbor) return { ok: false, error: 'rand' };
  const tx = db.transaction(() => {
    db.prepare('UPDATE ladder_players SET rank = ? WHERE id = ?').run(entry.rank, neighbor.id);
    db.prepare('UPDATE ladder_players SET rank = ? WHERE id = ?').run(targetRank, entry.id);
  });
  tx();
  return { ok: true };
}

// Admin-Sanktion (Regel 7): n Plätze zurück (Standard 10), dahinter rückt auf.
export function penalty(liste: Liste, name: string, plaetze = 10): Result {
  const db = getDb();
  const entry = getLadderEntry(liste, name);
  if (!entry) return { ok: false, error: 'nicht_drauf' };
  const n = getLadderEntries(liste).length;
  const ziel = Math.min(n, entry.rank + plaetze);
  if (ziel === entry.rank) return { ok: true };
  const tx = db.transaction(() => {
    // Block (alt+1 .. ziel) rückt eins nach vorne, Spieler ans Ziel.
    db.prepare('UPDATE ladder_players SET rank = 0 WHERE id = ?').run(entry.id);
    db.prepare('UPDATE ladder_players SET rank = rank - 1 WHERE liste = ? AND rank > ? AND rank <= ?').run(liste, entry.rank, ziel);
    db.prepare('UPDATE ladder_players SET rank = ? WHERE id = ?').run(ziel, entry.id);
  });
  tx();
  return { ok: true };
}

// ── Kaskade (Regel 2): Forderer (Rang C) siegt gegen Rang D (D < C) ─────────
// Zyklische Verschiebung des Blocks [D, C]: Forderer → D, vorherige D..C−1 → +1.
export function applyForderungsKaskade(liste: Liste, rangForderer: number, rangGeforderter: number): void {
  const db = getDb();
  const C = rangForderer;
  const D = rangGeforderter;
  if (D >= C) return;
  const tx = db.transaction(() => {
    const forderer = db
      .prepare('SELECT id FROM ladder_players WHERE liste = ? AND rank = ?')
      .get(liste, C) as { id: number } | undefined;
    if (!forderer) return;
    db.prepare('UPDATE ladder_players SET rank = 0 WHERE id = ?').run(forderer.id);
    db.prepare('UPDATE ladder_players SET rank = rank + 1 WHERE liste = ? AND rank >= ? AND rank < ?').run(liste, D, C);
    db.prepare('UPDATE ladder_players SET rank = ? WHERE id = ?').run(D, forderer.id);
  });
  tx();
}

// ── Forderung aussprechen ────────────────────────────────────────────────────
export function createChallenge(liste: Liste, challengerName: string, challengedName: string): Result<Challenge> {
  const db = getDb();
  const challenger = getLadderEntry(liste, challengerName);
  const challenged = getLadderEntry(liste, challengedName);
  if (!challenger) return { ok: false, error: 'nicht_drauf' };
  if (!challenged) return { ok: false, error: 'gegner_nicht_drauf' };

  const n = getLadderEntries(liste).length;
  if (!forderbareGegner(challenger.rank, n).includes(challenged.rank)) return { ok: false, error: 'nicht_forderbar' };

  if (hatOffeneForderung(liste, challengerName)) return { ok: false, error: 'eigene_offene' };
  if (hatOffeneForderung(liste, challengedName)) return { ok: false, error: 'gegner_offene' };

  // Sperr-/Schutzfristen (Regeln 2 + 3).
  const now = db.prepare("SELECT datetime('now') AS t").get() as { t: string };
  if (challenger.gesperrt_bis && challenger.gesperrt_bis > now.t) return { ok: false, error: 'gesperrt' };
  if (challenged.geschuetzt_bis && challenged.geschuetzt_bis > now.t) return { ok: false, error: 'geschuetzt' };

  // Gleicher Gegner max. 2× pro Saison (Regel 4); zurückgezogene zählen nicht.
  const saison = new Date().getFullYear();
  const count = (db
    .prepare(
      "SELECT COUNT(*) AS n FROM challenges WHERE liste = ? AND saison = ? AND challenger = ? AND challenged = ? AND status != 'zurueckgezogen'",
    )
    .get(liste, saison, challengerName, challengedName) as { n: number }).n;
  if (count >= 2) return { ok: false, error: 'max_pro_saison' };

  const id = db
    .prepare(
      `INSERT INTO challenges (liste, saison, challenger, challenged, deadline)
       VALUES (?, ?, ?, ?, datetime('now', '+14 days'))`,
    )
    .run(liste, saison, challengerName, challengedName).lastInsertRowid as number;
  return { ok: true, value: getChallenge(id)! };
}

// Termin an der Forderung pflegen (für Anzeige + 24h-Rückzugsregel).
export function setChallengeTermin(id: number, termin: string | null): void {
  getDb().prepare('UPDATE challenges SET termin = ? WHERE id = ?').run(termin, id);
}

// ── Ergebnis-Flow (analog VM: eintragen → Gegenseite bestätigt) ─────────────
export function enterChallengeResult(
  id: number,
  user: { id: number; player_name: string },
  input: { typ: string; satz1?: string | null; satz2?: string | null; mtb?: string | null; siegerRel?: string | null },
): Result<Challenge> {
  const db = getDb();
  const c = getChallenge(id);
  if (!c || c.status !== 'offen') return { ok: false, error: 'gone' };
  const isChallenger = c.challenger === user.player_name;
  const isChallenged = c.challenged === user.player_name;
  if (!isChallenger && !isChallenged) return { ok: false, error: 'notyours' };

  // validateEntry arbeitet mit Seiten A/B: A = Forderer, B = Geforderter.
  // Sätze werden aus Sicht des EINTRAGENDEN erfasst — trägt der Geforderte (B)
  // ein, müssen sie für die A-Perspektive gespiegelt werden.
  const meineSeite = isChallenger ? 'A' : 'B';
  const andereSeite = isChallenger ? 'B' : 'A';
  const flip = !isChallenger;
  const valid = validateEntry({
    typ: input.typ,
    satz1: flip ? flipSet(input.satz1) : input.satz1,
    satz2: flip ? flipSet(input.satz2) : input.satz2,
    mtb: flip ? flipSet(input.mtb) : input.mtb,
    sieger: input.siegerRel === 'me' ? meineSeite : input.siegerRel === 'opp' ? andereSeite : null,
  });
  if (!valid.ok) return { ok: false, error: 'score' };
  const s: EntryScore = valid.score;

  db.prepare(
    `UPDATE challenges SET satz1 = ?, satz2 = ?, mtb = ?, ergebnis_typ = ?, sieger = ?, eingetragen_von = ?, status = 'ergebnis_pending'
     WHERE id = ?`,
  ).run(s.satz1, s.satz2, s.mtb, s.typ, s.sieger === 'A' ? 'challenger' : 'challenged', user.id, id);
  return { ok: true, value: getChallenge(id)! };
}

// Wendet die TBS-Folgen eines entschiedenen Ergebnisses an (Kaskade/Sperre/Schutz).
function applyOutcome(c: Challenge, sieger: 'challenger' | 'challenged'): void {
  const db = getDb();
  const challenger = getLadderEntry(c.liste, c.challenger);
  const challenged = getLadderEntry(c.liste, c.challenged);
  const tx = db.transaction(() => {
    if (sieger === 'challenger') {
      if (challenger && challenged && challenged.rank < challenger.rank) {
        applyForderungsKaskade(c.liste, challenger.rank, challenged.rank);
      }
    } else {
      // Niederlage des Forderers: keine Rangänderung, 7 Tage Forderungssperre.
      db.prepare("UPDATE ladder_players SET gesperrt_bis = datetime('now', '+7 days') WHERE liste = ? AND player_name = ?").run(
        c.liste,
        c.challenger,
      );
    }
    // Siegerrechte (Regel 3): 2 Tage geschützt + erneut forderungsberechtigt.
    const siegerName = sieger === 'challenger' ? c.challenger : c.challenged;
    db.prepare("UPDATE ladder_players SET geschuetzt_bis = datetime('now', '+2 days') WHERE liste = ? AND player_name = ?").run(
      c.liste,
      siegerName,
    );
  });
  tx();
}

export function decideChallengeResult(
  id: number,
  user: { id: number; player_name: string },
  accept: boolean,
): Result<Challenge> {
  const db = getDb();
  const c = getChallenge(id);
  if (!c || c.status !== 'ergebnis_pending' || !c.sieger) return { ok: false, error: 'gone' };
  const isParticipant = c.challenger === user.player_name || c.challenged === user.player_name;
  if (!isParticipant) return { ok: false, error: 'notyours' };
  if (c.eingetragen_von === user.id) return { ok: false, error: 'ownresult' };

  if (!accept) {
    db.prepare(
      `UPDATE challenges SET status = 'offen', satz1 = NULL, satz2 = NULL, mtb = NULL,
       ergebnis_typ = 'gespielt', sieger = NULL, eingetragen_von = NULL WHERE id = ?`,
    ).run(id);
    return { ok: true, value: getChallenge(id)! };
  }

  db.prepare("UPDATE challenges SET status = 'gespielt', decided_at = datetime('now'), decided_by = ? WHERE id = ?").run(
    user.id,
    id,
  );
  applyOutcome(c, c.sieger);
  return { ok: true, value: getChallenge(id)! };
}

// Rückzug (Regel 5): nur der Forderer, solange kein Ergebnis eingetragen ist;
// ist ein Termin gepflegt, nur bis 24 h davor.
export function withdrawChallenge(id: number, user: { id: number; player_name: string }): Result<Challenge> {
  const db = getDb();
  const c = getChallenge(id);
  if (!c || c.status !== 'offen') return { ok: false, error: 'gone' };
  if (c.challenger !== user.player_name) return { ok: false, error: 'notyours' };
  if (c.termin) {
    const cutoff = new Date(c.termin).getTime() - 24 * 60 * 60 * 1000;
    if (Number.isFinite(cutoff) && Date.now() > cutoff) return { ok: false, error: 'zu_spaet' };
  }
  db.prepare(
    "UPDATE challenges SET status = 'zurueckgezogen', ergebnis_typ = 'zurueckgezogen', decided_at = datetime('now'), decided_by = ? WHERE id = ?",
  ).run(user.id, id);
  return { ok: true, value: getChallenge(id)! };
}

// Admin wertet eine überfällige Forderung (Regel 12).
export type ExpiredOutcome = 'kampflos_challenger' | 'kampflos_challenged' | 'verfallen';

export function resolveExpired(id: number, adminId: number, outcome: ExpiredOutcome): Result<Challenge> {
  const db = getDb();
  const c = getChallenge(id);
  if (!c || (c.status !== 'offen' && c.status !== 'ergebnis_pending')) return { ok: false, error: 'gone' };

  if (outcome === 'verfallen') {
    db.prepare("UPDATE challenges SET status = 'verfallen', decided_at = datetime('now'), decided_by = ? WHERE id = ?").run(
      adminId,
      id,
    );
    return { ok: true, value: getChallenge(id)! };
  }

  const sieger = outcome === 'kampflos_challenger' ? 'challenger' : 'challenged';
  db.prepare(
    `UPDATE challenges SET status = 'kampflos', ergebnis_typ = 'kampflos', sieger = ?,
     satz1 = NULL, satz2 = NULL, mtb = NULL, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
  ).run(sieger, adminId, id);
  applyOutcome(c, sieger);
  return { ok: true, value: getChallenge(id)! };
}

export function getOverdueChallenges(): (Challenge & { tage: number })[] {
  return getDb()
    .prepare(
      `SELECT *, CAST(julianday('now') - julianday(deadline) AS INTEGER) AS tage
       FROM challenges
       WHERE status IN ('offen','ergebnis_pending') AND deadline < datetime('now')
       ORDER BY deadline`,
    )
    .all() as (Challenge & { tage: number })[];
}

// ── Anzeige-Helfer ───────────────────────────────────────────────────────────
export function fmtDatum(sqlDatetime: string | null): string {
  if (!sqlDatetime) return '';
  const d = new Date(sqlDatetime.replace(' ', 'T') + (sqlDatetime.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return sqlDatetime;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatChallengeResult(c: Challenge): string {
  const base = [c.satz1, c.satz2, c.mtb].filter(Boolean).join(' · ');
  if (c.ergebnis_typ === 'wo' || c.ergebnis_typ === 'kampflos') return 'kampflos (w.o.)';
  if (c.ergebnis_typ === 'aufgabe') return base ? `${base} · Aufgabe` : 'Aufgabe';
  return base;
}
