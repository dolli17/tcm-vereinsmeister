// Spielerstatistik über alle Konkurrenzen einer Saison. Gruppen-Konkurrenzen
// liefern Tabelle + Punkteaufschlüsselung, KO-Konkurrenzen eine Match-Liste.
import {
  getActiveSeason,
  getCompetitions,
  getCompetitionPlayers,
  getEnrichedMatches,
  isPlayed,
  isPlaceholderName,
  teamPlayers,
  type Competition,
  type EnrichedMatch,
  type Season,
} from './tournament';
import { getDb } from './db';
import {
  computeStandings,
  explainMatchPoints,
  formatResult,
  type MatchPointBreakdown,
  type StandingRow,
} from './standings';

export function slugifyPlayer(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Alle bekannten Spielernamen (globaler Stamm) für Suche/Slug-Auflösung.
export function getAllPlayerNames(): string[] {
  const rows = getDb().prepare('SELECT name FROM players ORDER BY name COLLATE NOCASE').all() as { name: string }[];
  return rows.map((r) => r.name).filter((n) => !isPlaceholderName(n));
}

export function getPlayerBySlug(slug: string): string | undefined {
  return getAllPlayerNames().find((name) => slugifyPlayer(name) === slug);
}

export type TeamMatchView = {
  runde: string | null;
  nr: number;
  team: string;
  partner: string;
  opponent: string;
  termin: string | null;
  result: string;
  status: 'Gespielt' | 'Terminiert' | 'Offen' | 'Freilos';
};

export type CompetitionStat = {
  competition: Competition;
  gruppe: number | null;
  standing: StandingRow | null;
  breakdowns: MatchPointBreakdown[];
  teamMatches: TeamMatchView[];
  gespielt: number;
  total: number;
};

function teamView(m: EnrichedMatch, name: string): TeamMatchView {
  const a = teamPlayers(m.sideA);
  const b = teamPlayers(m.sideB);
  const inA = a.includes(name);
  const own = inA ? a : b;
  const other = inA ? b : a;
  const isBye = other.length === 0;
  const result = formatResult(m);
  const status: TeamMatchView['status'] = isBye
    ? 'Freilos'
    : isPlayed(m)
      ? 'Gespielt'
      : m.termin
        ? 'Terminiert'
        : 'Offen';
  return {
    runde: m.runde,
    nr: m.nr,
    team: own.join(' / '),
    partner: own.find((p) => p !== name) ?? 'ohne Partner',
    opponent: isBye ? 'Freilos' : other.join(' / '),
    termin: m.termin,
    result,
    status,
  };
}

export type PlayerStats = {
  name: string;
  slug: string;
  season: Season | null;
  competitions: CompetitionStat[];
  totals: { punkte: number; gespielt: number; total: number };
};

export function getPlayerStats(name: string, seasonId?: number): PlayerStats {
  const season = seasonId != null ? getActiveSeasonOrId(seasonId) : getActiveSeason();
  const competitions: CompetitionStat[] = [];
  let punkte = 0;
  let gespielt = 0;
  let total = 0;

  if (season) {
    for (const comp of getCompetitions(season.id)) {
      const matches = getEnrichedMatches(comp.id).filter(
        (m) => teamPlayers(m.sideA).includes(name) || teamPlayers(m.sideB).includes(name),
      );
      if (matches.length === 0) continue;

      const playable = matches.filter((m) => teamPlayers(m.sideA).length > 0 && teamPlayers(m.sideB).length > 0);
      const played = playable.filter((m) => isPlayed(m)).length;
      gespielt += played;
      total += playable.length;

      if (comp.modus === 'gruppe') {
        const cp = getCompetitionPlayers(comp.id).find((p) => p.player_name === name);
        const gruppe = cp?.gruppe ?? matches.find((m) => m.gruppe != null)?.gruppe ?? null;
        const standing = gruppe != null ? computeStandings(comp.id, gruppe).find((r) => r.name === name) ?? null : null;
        if (standing) punkte += standing.punkte;
        const breakdowns = matches
          .map((m) => explainMatchPoints(m, name))
          .filter((b): b is MatchPointBreakdown => Boolean(b));
        competitions.push({ competition: comp, gruppe, standing, breakdowns, teamMatches: [], gespielt: played, total: playable.length });
      } else {
        const teamMatches = matches.map((m) => teamView(m, name));
        competitions.push({ competition: comp, gruppe: null, standing: null, breakdowns: [], teamMatches, gespielt: played, total: playable.length });
      }
    }
  }

  return { name, slug: slugifyPlayer(name), season, competitions, totals: { punkte, gespielt, total } };
}

function getActiveSeasonOrId(seasonId: number): Season | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) as Season | undefined) ?? null;
}

// ── Karriere über alle Saisons (bestätigte VM-Spiele) ───────────────────────
export type CareerStats = {
  gespielt: number;
  siege: number;
  // Formkurve: letzte 10 Ergebnisse, neuestes zuerst (true = Sieg).
  form: boolean[];
  seasons: { jahr: number; gespielt: number; siege: number }[];
  gegner: { name: string; spiele: number; siege: number }[];
};

export function getPlayerCareer(name: string): CareerStats {
  const rows = getDb()
    .prepare(
      `SELECT r.sieger, m.side_a, m.side_b, s.jahr
       FROM results r
       JOIN matches m ON m.id = r.match_id
       JOIN competitions c ON c.id = m.competition_id
       JOIN seasons s ON s.id = c.season_id
       WHERE r.status = 'confirmed' AND r.match_id IS NOT NULL
       ORDER BY COALESCE(r.decided_at, r.created_at), r.id`,
    )
    .all() as { sieger: 'A' | 'B'; side_a: string | null; side_b: string | null; jahr: number }[];

  let gespielt = 0;
  let siege = 0;
  const results: boolean[] = [];
  const bySeason = new Map<number, { gespielt: number; siege: number }>();
  const byOpponent = new Map<string, { spiele: number; siege: number }>();

  for (const r of rows) {
    const a = teamPlayers(r.side_a);
    const b = teamPlayers(r.side_b);
    const inA = a.includes(name);
    const inB = b.includes(name);
    if (!inA && !inB) continue;
    const won = r.sieger === (inA ? 'A' : 'B');
    const opponents = inA ? b : a;
    if (opponents.length === 0) continue;

    gespielt++;
    if (won) siege++;
    results.push(won);

    const season = bySeason.get(r.jahr) ?? { gespielt: 0, siege: 0 };
    season.gespielt++;
    if (won) season.siege++;
    bySeason.set(r.jahr, season);

    for (const opp of opponents) {
      const o = byOpponent.get(opp) ?? { spiele: 0, siege: 0 };
      o.spiele++;
      if (won) o.siege++;
      byOpponent.set(opp, o);
    }
  }

  return {
    gespielt,
    siege,
    form: results.slice(-10).reverse(),
    seasons: Array.from(bySeason.entries())
      .map(([jahr, v]) => ({ jahr, ...v }))
      .sort((x, y) => y.jahr - x.jahr),
    gegner: Array.from(byOpponent.entries())
      .map(([n, v]) => ({ name: n, ...v }))
      .sort((x, y) => y.spiele - x.spiele || x.name.localeCompare(y.name, 'de'))
      .slice(0, 5),
  };
}
