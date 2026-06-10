// Zentraler DB-Zugriff auf das Mehrjahres-Turniermodell: Saisons, Konkurrenzen,
// Teilnehmer und Paarungen (matches). Ergebnisse werden über match_id aus der
// results-Tabelle überlagert. Spielerverknüpfung bleibt namensbasiert.
import { getDb } from './db';

export type SeasonStatus = 'aktiv' | 'archiviert';
export type CompetitionArt = 'einzel' | 'doppel';
export type CompetitionModus = 'gruppe' | 'ko';
export type Sieger = 'A' | 'B' | null;
// 'wo' = kampflos (Walkover), 'aufgabe' = Abbruch beim erfassten Spielstand.
export type ErgebnisTyp = 'gespielt' | 'wo' | 'aufgabe';

export type Season = {
  id: number;
  jahr: number;
  name: string;
  status: SeasonStatus;
  anmeldung_offen: number; // 0 | 1 — Meldefenster für Selbst-Anmeldung
  created_at: string;
};

export type Competition = {
  id: number;
  season_id: number;
  slug: string;
  name: string;
  art: CompetitionArt;
  modus: CompetitionModus;
  sort: number;
  status: string;
};

export type CompetitionPlayer = {
  player_name: string;
  gruppe: number | null;
  gesetzt: boolean;
};

export type MatchRow = {
  id: number;
  competition_id: number;
  gruppe: number | null;
  runde: string | null;
  monat: string | null;
  nr: number;
  side_a: string | null;
  side_b: string | null;
  termin: string | null;
  source_match_a: number | null;
  source_match_b: number | null;
};

// Eine Paarung inkl. überlagertem, bestätigtem Ergebnis (einheitliche Form für
// Einzel und Doppel/Mixed: side_a/side_b sind "Name" bzw. "Name1 / Name2").
export type EnrichedMatch = {
  id: number;
  competitionId: number;
  gruppe: number | null;
  runde: string | null;
  monat: string | null;
  nr: number;
  sideA: string | null;
  sideB: string | null;
  termin: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: Sieger;
  ergebnisTyp: ErgebnisTyp;
};

// ── Spieler-/Team-Helfer ─────────────────────────────────────────────────────
// Liefert nur ECHTE Spielernamen: BYE/TBD und Bracket-Platzhalter ("Sieger …")
// fallen raus — sie dürfen nirgends als spielbare Gegner auftauchen.
export function teamPlayers(side: string | null): string[] {
  if (!side || side === 'BYE' || side === 'TBD') return [];
  return side
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && !isPlaceholderName(p));
}

// "Sieger Match 1", "Sieger Viertelfinale 2", … sind Bracket-Platzhalter, keine
// echten Spielernamen.
export function isPlaceholderName(name: string): boolean {
  return /^Sieger\s/i.test(name);
}

export function isPlayed(m: { sieger: Sieger }): boolean {
  return m.sieger === 'A' || m.sieger === 'B';
}

export function isByeMatch(m: { sideA: string | null; sideB: string | null }): boolean {
  return teamPlayers(m.sideA).length === 0 || teamPlayers(m.sideB).length === 0;
}

// ── Saisons ──────────────────────────────────────────────────────────────────
export function getActiveSeason(): Season | null {
  return (
    (getDb()
      .prepare("SELECT * FROM seasons WHERE status = 'aktiv' ORDER BY jahr DESC LIMIT 1")
      .get() as Season | undefined) ?? null
  );
}

export function listSeasons(): Season[] {
  return getDb().prepare('SELECT * FROM seasons ORDER BY jahr DESC').all() as Season[];
}

export function getSeason(id: number): Season | null {
  return (getDb().prepare('SELECT * FROM seasons WHERE id = ?').get(id) as Season | undefined) ?? null;
}

export function getSeasonByJahr(jahr: number): Season | null {
  return (
    (getDb().prepare('SELECT * FROM seasons WHERE jahr = ? LIMIT 1').get(jahr) as Season | undefined) ?? null
  );
}

// Die anzuzeigende Saison: explizit per Jahr gewählt, sonst die aktive.
export function resolveSeason(jahr?: number | null): Season | null {
  if (jahr != null && Number.isFinite(jahr)) {
    const s = getSeasonByJahr(jahr);
    if (s) return s;
  }
  return getActiveSeason();
}

// ── Konkurrenzen ─────────────────────────────────────────────────────────────
export function getCompetitions(seasonId: number): Competition[] {
  return getDb()
    .prepare("SELECT * FROM competitions WHERE season_id = ? AND status != 'geloescht' ORDER BY sort, id")
    .all(seasonId) as Competition[];
}

export function getCompetition(id: number): Competition | null {
  return (
    (getDb().prepare('SELECT * FROM competitions WHERE id = ?').get(id) as Competition | undefined) ?? null
  );
}

export function getCompetitionBySlug(seasonId: number, slug: string): Competition | null {
  return (
    (getDb()
      .prepare('SELECT * FROM competitions WHERE season_id = ? AND slug = ?')
      .get(seasonId, slug) as Competition | undefined) ?? null
  );
}

// ── Teilnehmer ───────────────────────────────────────────────────────────────
export function getCompetitionPlayers(competitionId: number): CompetitionPlayer[] {
  const rows = getDb()
    .prepare(
      'SELECT player_name, gruppe, gesetzt FROM competition_players WHERE competition_id = ? ORDER BY gruppe, player_name COLLATE NOCASE',
    )
    .all(competitionId) as { player_name: string; gruppe: number | null; gesetzt: number }[];
  return rows.map((r) => ({ player_name: r.player_name, gruppe: r.gruppe, gesetzt: !!r.gesetzt }));
}

// ── Paarungen + Ergebnis-Überlagerung ────────────────────────────────────────
export function getMatchRows(competitionId: number): MatchRow[] {
  return getDb()
    .prepare('SELECT * FROM matches WHERE competition_id = ? ORDER BY nr')
    .all(competitionId) as MatchRow[];
}

type ConfirmedRow = { match_id: number; satz1: string | null; satz2: string | null; mtb: string | null; sieger: Sieger; ergebnis_typ: ErgebnisTyp };

// Bestätigte Ergebnisse je match_id für eine Konkurrenz.
function confirmedByMatchId(competitionId: number): Map<number, ConfirmedRow> {
  const rows = getDb()
    .prepare(
      `SELECT r.match_id, r.satz1, r.satz2, r.mtb, r.sieger, r.ergebnis_typ
       FROM results r JOIN matches m ON m.id = r.match_id
       WHERE m.competition_id = ? AND r.status = 'confirmed' AND r.match_id IS NOT NULL`,
    )
    .all(competitionId) as ConfirmedRow[];
  const map = new Map<number, ConfirmedRow>();
  for (const r of rows) map.set(r.match_id, r);
  return map;
}

export function getEnrichedMatches(competitionId: number): EnrichedMatch[] {
  const confirmed = confirmedByMatchId(competitionId);
  return getMatchRows(competitionId).map((m) => {
    const res = confirmed.get(m.id);
    return {
      id: m.id,
      competitionId: m.competition_id,
      gruppe: m.gruppe,
      runde: m.runde,
      monat: m.monat,
      nr: m.nr,
      sideA: m.side_a,
      sideB: m.side_b,
      termin: m.termin,
      satz1: res?.satz1 ?? null,
      satz2: res?.satz2 ?? null,
      mtb: res?.mtb ?? null,
      sieger: res?.sieger ?? null,
      ergebnisTyp: res?.ergebnis_typ ?? 'gespielt',
    };
  });
}

// Distinkte Gruppennummern einer Gruppen-Konkurrenz (aus Teilnehmern + Paarungen).
export function getGruppen(competitionId: number): number[] {
  const set = new Set<number>();
  for (const p of getCompetitionPlayers(competitionId)) if (p.gruppe != null) set.add(p.gruppe);
  for (const m of getMatchRows(competitionId)) if (m.gruppe != null) set.add(m.gruppe);
  return Array.from(set).sort((a, b) => a - b);
}

// Runden einer KO-Konkurrenz in Reihenfolge des ersten Auftretens.
export function getRunden(competitionId: number): string[] {
  const order: string[] = [];
  for (const m of getMatchRows(competitionId)) {
    if (m.runde && !order.includes(m.runde)) order.push(m.runde);
  }
  return order;
}

// Monate (Anzeige-/Fälligkeitsmonate) in kalendarischer Reihenfolge.
export const MONTH_ORDER = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
export function monthIndex(monat: string | null | undefined): number {
  if (!monat) return 99;
  const i = MONTH_ORDER.indexOf(monat);
  return i < 0 ? 99 : i;
}
export function getMonate(competitionId: number): string[] {
  const set = new Set<string>();
  for (const m of getMatchRows(competitionId)) if (m.monat) set.add(m.monat);
  return Array.from(set).sort((a, b) => monthIndex(a) - monthIndex(b));
}

// ── KO-Automatik ─────────────────────────────────────────────────────────────
// Schreibt den Sieger eines Matches in alle Folgematches (source_match_a/b).
// Ohne bestätigtes Ergebnis wird der Anzeige-Platzhalter wiederhergestellt —
// dadurch ist die Funktion auch das "Zurückrollen" nach Ergebnis-Löschung.
// Freilos: genau eine echte Seite, die andere ist 'BYE' → die echte Seite rückt vor.
function byeWinner(m: { side_a: string | null; side_b: string | null }): string | null {
  if (m.side_b === 'BYE' && teamPlayers(m.side_a).length > 0) return m.side_a;
  if (m.side_a === 'BYE' && teamPlayers(m.side_b).length > 0) return m.side_b;
  return null;
}

export function syncBracketForMatch(matchId: number): void {
  const db = getDb();
  const src = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
  if (!src) return;
  const res = db
    .prepare("SELECT sieger FROM results WHERE match_id = ? AND status = 'confirmed' LIMIT 1")
    .get(matchId) as { sieger: 'A' | 'B' } | undefined;
  const winner = res ? (res.sieger === 'A' ? src.side_a : src.side_b) : byeWinner(src);

  const deps = db
    .prepare('SELECT * FROM matches WHERE source_match_a = ? OR source_match_b = ?')
    .all(matchId, matchId) as MatchRow[];
  for (const dep of deps) {
    // Eine Folgepartie mit bestätigtem Ergebnis wird nicht mehr angefasst.
    if (db.prepare("SELECT 1 FROM results WHERE match_id = ? AND status = 'confirmed'").get(dep.id)) continue;
    const col = dep.source_match_a === matchId ? 'side_a' : 'side_b';
    const value = winner ?? `Sieger Match ${src.nr}`;
    db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(value, dep.id);
  }
}

// Erzeugt ein komplettes KO-Bracket aus den Teilnehmern (gesetzte Spieler als
// Setzliste, Rest gelost; Freilose für die Setzliste, Sieger rücken automatisch vor).
export function generateKoBracket(competitionId: number): { ok: true; created: number } | { ok: false; error: string } {
  const db = getDb();
  if (getMatchRows(competitionId).length > 0) return { ok: false, error: 'koexists' };
  const all = getCompetitionPlayers(competitionId);
  if (all.length < 2) return { ok: false, error: 'koplayers' };

  const gesetzt = all.filter((p) => p.gesetzt).map((p) => p.player_name);
  const rest = all.filter((p) => !p.gesetzt).map((p) => p.player_name);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const seeds = [...gesetzt, ...rest]; // Position = Setzplatz

  let size = 2;
  while (size < seeds.length) size *= 2;

  // Standard-Setzreihenfolge: Setzplatz 1 und 2 können sich erst im Finale treffen.
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2 + 1;
    order = order.flatMap((x) => [x, m - x]);
  }
  const slots = order.map((seed) => (seed <= seeds.length ? seeds[seed - 1] : 'BYE'));

  const roundName = (matchesInRound: number, idx: number): string =>
    matchesInRound === 1 ? 'Finale' : matchesInRound === 2 ? 'Halbfinale' : matchesInRound === 4 ? 'Viertelfinale' : matchesInRound === 8 ? 'Achtelfinale' : `${idx}. Runde`;

  const ins = db.prepare(
    'INSERT INTO matches (competition_id, gruppe, runde, monat, nr, side_a, side_b, termin, source_match_a, source_match_b) VALUES (?, NULL, ?, NULL, ?, ?, ?, NULL, ?, ?)',
  );

  let created = 0;
  const tx = db.transaction(() => {
    let nr = 0;
    // Runde 1 aus den Slots, Folgerunden mit source-Referenzen.
    let prev: { id: number; nr: number; sideA: string; sideB: string }[] = [];
    for (let i = 0; i < size; i += 2) {
      const name = roundName(size / 2, 1);
      const id = ins.run(competitionId, name, ++nr, slots[i], slots[i + 1], null, null).lastInsertRowid as number;
      prev.push({ id, nr, sideA: slots[i], sideB: slots[i + 1] });
      created++;
    }
    let roundIdx = 2;
    while (prev.length > 1) {
      const next: typeof prev = [];
      const name = roundName(prev.length / 2, roundIdx);
      for (let i = 0; i < prev.length; i += 2) {
        const a = prev[i];
        const b = prev[i + 1];
        // Freilos in der Vorrunde: der echte Spieler rückt direkt vor.
        const sideA = a.sideB === 'BYE' ? a.sideA : a.sideA === 'BYE' ? a.sideB : `Sieger Match ${a.nr}`;
        const sideB = b.sideB === 'BYE' ? b.sideA : b.sideA === 'BYE' ? b.sideB : `Sieger Match ${b.nr}`;
        const id = ins.run(competitionId, name, ++nr, sideA, sideB, a.id, b.id).lastInsertRowid as number;
        next.push({ id, nr, sideA, sideB });
        created++;
      }
      prev = next;
      roundIdx++;
    }
  });
  tx();
  return { ok: true, created };
}
