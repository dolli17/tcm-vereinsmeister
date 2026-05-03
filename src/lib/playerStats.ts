import doppelData from '../data/doppel.json';
import einzelData from '../data/einzel.json';
import spielerData from '../data/spieler.json';
import { computeStandings, formatResult, matchStatus, type Match, type Spieler } from './standings';

export type DoppelMatch = {
  runde: string;
  nr: number;
  doppelA: string | null;
  doppelB: string | null;
  termin: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B' | null;
};

export type PointLine = {
  result: string;
  label: string;
  points: number;
};

export type MatchPointBreakdown = {
  match: Match;
  opponent: string;
  status: 'gespielt' | 'terminiert' | 'offen';
  result: string;
  won: boolean;
  lines: PointLine[];
  bonus: number;
  total: number;
};

const ALL_EINZEL_MATCHES = einzelData.matches as Match[];
const ALL_DOPPEL_MATCHES = doppelData.matches as DoppelMatch[];
const ALL_EINZEL_SPIELER = spielerData.einzel as Spieler[];

function parseSet(set: string | null): { a: number; b: number } | null {
  if (!set) return null;
  const m = set.match(/^(\d+)[:\-](\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

function scoreSet(set: { a: number; b: number }, isA: boolean, isMtb: boolean): PointLine {
  const meine = isA ? set.a : set.b;
  const fremde = isA ? set.b : set.a;
  const gewonnen = meine > fremde;
  const winnerGames = Math.max(set.a, set.b);
  const loserGames = Math.min(set.a, set.b);
  const result = `${meine}:${fremde}`;

  if (isMtb) {
    return {
      result,
      label: gewonnen ? 'Match-Tiebreak gewonnen' : 'Match-Tiebreak verloren',
      points: gewonnen ? 5 : 3,
    };
  }
  if (winnerGames === 6 && loserGames === 0) {
    return { result, label: gewonnen ? '6:0 gewonnen' : '6:0 verloren', points: gewonnen ? 8 : 0 };
  }
  if (winnerGames === 6 && loserGames >= 1 && loserGames <= 4) {
    return { result, label: gewonnen ? 'Satz gewonnen' : 'Satz verloren', points: gewonnen ? 7 : 0 };
  }
  if (winnerGames === 7 && loserGames === 5) {
    return { result, label: gewonnen ? 'Verlaengerter Satz gewonnen' : 'Verlaengerter Satz verloren', points: gewonnen ? 6 : 1 };
  }
  if (winnerGames === 7 && loserGames === 6) {
    return { result, label: gewonnen ? 'Tiebreak gewonnen' : 'Tiebreak verloren', points: gewonnen ? 4 : 2 };
  }
  return { result, label: 'Nicht gewertetes Satzformat', points: 0 };
}

export function slugifyPlayer(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function doppelPlayers(doppel: string | null): string[] {
  return doppel ? doppel.split('/').map((p) => p.trim()) : [];
}

export function getAllPlayerNames(): string[] {
  const doppelSpieler = ALL_DOPPEL_MATCHES.flatMap((m) => [...doppelPlayers(m.doppelA), ...doppelPlayers(m.doppelB)]);
  return Array.from(new Set([...ALL_EINZEL_SPIELER.map((s) => s.name), ...doppelSpieler])).sort((a, b) =>
    a.localeCompare(b, 'de'),
  );
}

export function getPlayerBySlug(slug: string): string | undefined {
  return getAllPlayerNames().find((name) => slugifyPlayer(name) === slug);
}

export function getPlayerEinzelMatches(name: string): Match[] {
  return ALL_EINZEL_MATCHES.filter((m) => m.spielerA === name || m.spielerB === name).sort((a, b) => a.gruppe - b.gruppe || a.nr - b.nr);
}

export function getPlayerDoppelMatches(name: string): DoppelMatch[] {
  return ALL_DOPPEL_MATCHES.filter((m) => [...doppelPlayers(m.doppelA), ...doppelPlayers(m.doppelB)].includes(name)).sort((a, b) => a.nr - b.nr);
}

export function explainMatchPoints(match: Match, name: string): MatchPointBreakdown | null {
  const isA = match.spielerA === name;
  const isB = match.spielerB === name;
  if (!isA && !isB) return null;

  const status = matchStatus(match);
  const won = match.sieger === (isA ? 'A' : 'B');
  const lines: PointLine[] = [];
  let setsWon = 0;
  let setsLost = 0;

  for (const setStr of [match.satz1, match.satz2]) {
    const set = parseSet(setStr);
    if (!set) continue;
    lines.push(scoreSet(set, isA, false));
    const meine = isA ? set.a : set.b;
    const fremde = isA ? set.b : set.a;
    if (meine > fremde) setsWon += 1;
    else setsLost += 1;
  }

  const mtb = parseSet(match.mtb);
  if (mtb) {
    lines.push(scoreSet(mtb, isA, true));
    const meine = isA ? mtb.a : mtb.b;
    const fremde = isA ? mtb.b : mtb.a;
    if (meine > fremde) setsWon += 1;
    else setsLost += 1;
  }

  const bonus = won ? (setsLost === 0 ? 9 : 3) : 0;
  const total = lines.reduce((sum, line) => sum + line.points, 0) + bonus;

  return {
    match,
    opponent: isA ? match.spielerB : match.spielerA,
    status,
    result: formatResult(match),
    won,
    lines,
    bonus,
    total,
  };
}

export function getPlayerStats(name: string) {
  const einzel = ALL_EINZEL_SPIELER.find((s) => s.name === name);
  const standing = einzel ? computeStandings(einzel.gruppe).find((row) => row.name === name) : undefined;
  const einzelMatches = getPlayerEinzelMatches(name);
  const doppelMatches = getPlayerDoppelMatches(name);
  const breakdowns = einzelMatches.map((m) => explainMatchPoints(m, name)).filter((m): m is MatchPointBreakdown => Boolean(m));
  const playedBreakdowns = breakdowns.filter((m) => m.status === 'gespielt');
  const doppelPlayed = doppelMatches.filter((m) => m.sieger === 'A' || m.sieger === 'B');

  return {
    name,
    slug: slugifyPlayer(name),
    einzel,
    standing,
    einzelMatches,
    doppelMatches,
    breakdowns,
    playedBreakdowns,
    totals: {
      einzelOffen: breakdowns.filter((m) => m.status === 'offen').length,
      einzelTerminiert: breakdowns.filter((m) => m.status === 'terminiert').length,
      einzelGespielt: playedBreakdowns.length,
      einzelPunkteAusSaetzen: playedBreakdowns.reduce((sum, m) => sum + m.lines.reduce((inner, line) => inner + line.points, 0), 0),
      einzelBonus: playedBreakdowns.reduce((sum, m) => sum + m.bonus, 0),
      doppelGespielt: doppelPlayed.length,
      doppelOffen: doppelMatches.length - doppelPlayed.length,
    },
  };
}

export function getDoppelTeam(match: DoppelMatch, name: string): { partner: string; opponent: string; team: string } {
  const teamA = doppelPlayers(match.doppelA);
  const teamB = doppelPlayers(match.doppelB);
  const inA = teamA.includes(name);
  const ownTeam = inA ? teamA : teamB;
  const otherTeam = inA ? teamB : teamA;

  return {
    team: ownTeam.join(' / '),
    partner: ownTeam.find((p) => p !== name) ?? 'ohne Partner',
    opponent: otherTeam.length > 0 ? otherTeam.join(' / ') : 'Freilos',
  };
}
