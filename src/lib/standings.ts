// Tabellenberechnung für Gruppen-Konkurrenzen (Einzel). Arbeitet auf den
// EnrichedMatches einer Konkurrenz; das tennis-spezifische Punktesystem ist
// unverändert. side_a/side_b sind im Einzel der jeweilige Spielername.
import {
  getCompetitionPlayers,
  getEnrichedMatches,
  getGruppen,
  isPlayed,
  teamPlayers,
  type EnrichedMatch,
  type ErgebnisTyp,
  type Sieger,
} from './tournament';
import { getPhoneMap } from './players';

export type StandingRow = {
  name: string;
  gesetzt: boolean;
  telefon?: string;
  gespielt: number;
  siege: number;
  niederlagen: number;
  saetzeGewonnen: number;
  saetzeVerloren: number;
  spieleGewonnen: number;
  spieleVerloren: number;
  punkte: number;
  platz: number;
};

function parseSet(set: string | null): { a: number; b: number } | null {
  if (!set) return null;
  const m = set.match(/^(\d+)[:\-](\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

export function isMatchPlayed(match: { sieger: Sieger }): boolean {
  return isPlayed(match);
}

export function formatResult(m: { satz1: string | null; satz2: string | null; mtb: string | null; sieger: Sieger; ergebnisTyp?: ErgebnisTyp }): string {
  if (!isPlayed(m)) return '';
  const base = [m.satz1, m.satz2, m.mtb].filter(Boolean).join(' · ');
  if (m.ergebnisTyp === 'wo') return 'kampflos (w.o.)';
  if (m.ergebnisTyp === 'aufgabe') return base ? `${base} · Aufgabe` : 'Aufgabe';
  return base;
}

// Für die Punktewertung zählt ein kampfloser Sieg wie 6:0, 6:0; bei Aufgabe
// zählen die erfassten Sätze (der Sieg-Bonus kommt regulär dazu).
function effectiveSets(m: EnrichedMatch): { satz1: string | null; satz2: string | null; mtb: string | null } {
  if (m.ergebnisTyp === 'wo') {
    const s = m.sieger === 'A' ? '6:0' : '0:6';
    return { satz1: s, satz2: s, mtb: null };
  }
  return { satz1: m.satz1, satz2: m.satz2, mtb: m.mtb };
}

export function matchStatus(m: { sieger: Sieger; termin: string | null }): 'gespielt' | 'terminiert' | 'offen' {
  if (isPlayed(m)) return 'gespielt';
  if (m.termin) return 'terminiert';
  return 'offen';
}

type PlayerStat = {
  saetzeGewonnen: number;
  saetzeVerloren: number;
  spieleGewonnen: number;
  spieleVerloren: number;
  hatGewonnen: boolean;
  punkte: number;
};

function scorePoints(set: { a: number; b: number }, istA: boolean, isMtb: boolean): number {
  const meine = istA ? set.a : set.b;
  const fremde = istA ? set.b : set.a;
  const gewonnen = meine > fremde;
  const winnerGames = Math.max(set.a, set.b);
  const loserGames = Math.min(set.a, set.b);

  if (isMtb) return gewonnen ? 5 : 3;
  if (winnerGames === 6 && loserGames === 0) return gewonnen ? 8 : 0;
  if (winnerGames === 6 && loserGames >= 1 && loserGames <= 4) return gewonnen ? 7 : 0;
  if (winnerGames === 7 && loserGames === 5) return gewonnen ? 6 : 1;
  if (winnerGames === 7 && loserGames === 6) return gewonnen ? 4 : 2;
  return 0;
}

function playerStats(match: EnrichedMatch, name: string): PlayerStat | null {
  if (!isPlayed(match)) return null;
  const istA = match.sideA === name;
  const istB = match.sideB === name;
  if (!istA && !istB) return null;

  const stat: PlayerStat = {
    saetzeGewonnen: 0,
    saetzeVerloren: 0,
    spieleGewonnen: 0,
    spieleVerloren: 0,
    hatGewonnen: match.sieger === (istA ? 'A' : 'B'),
    punkte: 0,
  };

  const eff = effectiveSets(match);
  for (const setStr of [eff.satz1, eff.satz2]) {
    const set = parseSet(setStr);
    if (!set) continue;
    const meine = istA ? set.a : set.b;
    const fremde = istA ? set.b : set.a;
    stat.spieleGewonnen += meine;
    stat.spieleVerloren += fremde;
    if (meine > fremde) stat.saetzeGewonnen += 1;
    else stat.saetzeVerloren += 1;
    stat.punkte += scorePoints(set, istA, false);
  }

  const mtb = parseSet(eff.mtb);
  if (mtb) {
    const meine = istA ? mtb.a : mtb.b;
    const fremde = istA ? mtb.b : mtb.a;
    if (meine > fremde) stat.saetzeGewonnen += 1;
    else stat.saetzeVerloren += 1;
    stat.punkte += scorePoints(mtb, istA, true);
  }

  if (stat.hatGewonnen) {
    stat.punkte += stat.saetzeVerloren === 0 ? 9 : 3;
  }

  return stat;
}

// Tabelle einer Gruppe innerhalb einer Konkurrenz (Gruppen-Modus, Einzel).
export function computeStandings(competitionId: number, gruppe: number): StandingRow[] {
  const spieler = getCompetitionPlayers(competitionId).filter((s) => s.gruppe === gruppe);
  const matches = getEnrichedMatches(competitionId).filter((m) => m.gruppe === gruppe);
  const phones = getPhoneMap();

  const rows: StandingRow[] = spieler.map((s) => ({
    name: s.player_name,
    gesetzt: s.gesetzt,
    telefon: phones[s.player_name],
    gespielt: 0,
    siege: 0,
    niederlagen: 0,
    saetzeGewonnen: 0,
    saetzeVerloren: 0,
    spieleGewonnen: 0,
    spieleVerloren: 0,
    punkte: 0,
    platz: 0,
  }));
  const byName = new Map(rows.map((r) => [r.name, r]));

  for (const m of matches) {
    if (!isPlayed(m)) continue;
    for (const name of [m.sideA, m.sideB]) {
      if (!name) continue;
      const stat = playerStats(m, name);
      const row = byName.get(name);
      if (!stat || !row) continue;
      row.gespielt += 1;
      row.siege += stat.hatGewonnen ? 1 : 0;
      row.niederlagen += stat.hatGewonnen ? 0 : 1;
      row.saetzeGewonnen += stat.saetzeGewonnen;
      row.saetzeVerloren += stat.saetzeVerloren;
      row.spieleGewonnen += stat.spieleGewonnen;
      row.spieleVerloren += stat.spieleVerloren;
      row.punkte += stat.punkte;
    }
  }

  rows.sort((a, b) => compareRows(a, b, matches, rows));
  rows.forEach((r, i) => {
    r.platz = i + 1;
  });
  return rows;
}

function compareRows(a: StandingRow, b: StandingRow, matches: EnrichedMatch[], allRows: StandingRow[]): number {
  if (a.punkte !== b.punkte) return b.punkte - a.punkte;

  const tied = allRows.filter((r) => r.punkte === a.punkte);
  if (tied.length >= 2) {
    const tiedNames = new Set(tied.map((r) => r.name));
    const tiedMatches = matches.filter(
      (m) => m.sideA != null && m.sideB != null && tiedNames.has(m.sideA) && tiedNames.has(m.sideB) && isPlayed(m),
    );
    const ah = h2hAggregate(a.name, tiedMatches);
    const bh = h2hAggregate(b.name, tiedMatches);
    if (ah.punkte !== bh.punkte) return bh.punkte - ah.punkte;
    const aSatzDiff = ah.saetzeGewonnen - ah.saetzeVerloren;
    const bSatzDiff = bh.saetzeGewonnen - bh.saetzeVerloren;
    if (aSatzDiff !== bSatzDiff) return bSatzDiff - aSatzDiff;
    const aSpielDiff = ah.spieleGewonnen - ah.spieleVerloren;
    const bSpielDiff = bh.spieleGewonnen - bh.spieleVerloren;
    if (aSpielDiff !== bSpielDiff) return bSpielDiff - aSpielDiff;
  }

  const aSatzDiffG = a.saetzeGewonnen - a.saetzeVerloren;
  const bSatzDiffG = b.saetzeGewonnen - b.saetzeVerloren;
  if (aSatzDiffG !== bSatzDiffG) return bSatzDiffG - aSatzDiffG;

  const aSpielDiffG = a.spieleGewonnen - a.spieleVerloren;
  const bSpielDiffG = b.spieleGewonnen - b.spieleVerloren;
  if (aSpielDiffG !== bSpielDiffG) return bSpielDiffG - aSpielDiffG;

  return 0;
}

function h2hAggregate(name: string, matches: EnrichedMatch[]) {
  const agg = { punkte: 0, saetzeGewonnen: 0, saetzeVerloren: 0, spieleGewonnen: 0, spieleVerloren: 0 };
  for (const m of matches) {
    const s = playerStats(m, name);
    if (!s) continue;
    agg.punkte += s.punkte;
    agg.saetzeGewonnen += s.saetzeGewonnen;
    agg.saetzeVerloren += s.saetzeVerloren;
    agg.spieleGewonnen += s.spieleGewonnen;
    agg.spieleVerloren += s.spieleVerloren;
  }
  return agg;
}

// Quali-Status je Gruppe für die K.o.-Runde: Gruppe fertig (alle Spiele mit zwei
// echten Seiten gespielt) + die beiden Erstplatzierten.
export type GruppenQuali = { gruppe: number; fertig: boolean; offen: number; quali: string[] };

export function getGruppenQuali(competitionId: number): GruppenQuali[] {
  const matches = getEnrichedMatches(competitionId);
  return getGruppen(competitionId).map((gruppe) => {
    const playable = matches.filter(
      (m) => m.gruppe === gruppe && teamPlayers(m.sideA).length > 0 && teamPlayers(m.sideB).length > 0,
    );
    const offen = playable.filter((m) => !isPlayed(m)).length;
    const quali = computeStandings(competitionId, gruppe)
      .filter((r) => r.platz <= 2)
      .map((r) => r.name);
    return { gruppe, fertig: playable.length > 0 && offen === 0, offen, quali };
  });
}

// Einzelpunkte-Aufschlüsselung für die Spielerstatistik.
export type PointLine = { result: string; label: string; points: number };
export type MatchPointBreakdown = {
  match: EnrichedMatch;
  opponent: string;
  status: 'gespielt' | 'terminiert' | 'offen';
  result: string;
  won: boolean;
  lines: PointLine[];
  bonus: number;
  total: number;
};

function scoreSet(set: { a: number; b: number }, isA: boolean, isMtb: boolean): PointLine {
  const meine = isA ? set.a : set.b;
  const fremde = isA ? set.b : set.a;
  const gewonnen = meine > fremde;
  const winnerGames = Math.max(set.a, set.b);
  const loserGames = Math.min(set.a, set.b);
  const result = `${meine}:${fremde}`;

  if (isMtb) return { result, label: gewonnen ? 'Match-Tiebreak gewonnen' : 'Match-Tiebreak verloren', points: gewonnen ? 5 : 3 };
  if (winnerGames === 6 && loserGames === 0) return { result, label: gewonnen ? '6:0 gewonnen' : '6:0 verloren', points: gewonnen ? 8 : 0 };
  if (winnerGames === 6 && loserGames >= 1 && loserGames <= 4) return { result, label: gewonnen ? 'Satz gewonnen' : 'Satz verloren', points: gewonnen ? 7 : 0 };
  if (winnerGames === 7 && loserGames === 5) return { result, label: gewonnen ? 'Verlaengerter Satz gewonnen' : 'Verlaengerter Satz verloren', points: gewonnen ? 6 : 1 };
  if (winnerGames === 7 && loserGames === 6) return { result, label: gewonnen ? 'Tiebreak gewonnen' : 'Tiebreak verloren', points: gewonnen ? 4 : 2 };
  return { result, label: 'Nicht gewertetes Satzformat', points: 0 };
}

export function explainMatchPoints(match: EnrichedMatch, name: string): MatchPointBreakdown | null {
  const isA = match.sideA === name;
  const isB = match.sideB === name;
  if (!isA && !isB) return null;

  const status = matchStatus(match);
  const won = match.sieger === (isA ? 'A' : 'B');
  const lines: PointLine[] = [];
  let setsLost = 0;

  const eff = effectiveSets(match);
  for (const setStr of [eff.satz1, eff.satz2]) {
    const set = parseSet(setStr);
    if (!set) continue;
    lines.push(scoreSet(set, isA, false));
    const meine = isA ? set.a : set.b;
    const fremde = isA ? set.b : set.a;
    if (meine <= fremde) setsLost += 1;
  }

  const mtb = parseSet(eff.mtb);
  if (mtb) {
    lines.push(scoreSet(mtb, isA, true));
    const meine = isA ? mtb.a : mtb.b;
    const fremde = isA ? mtb.b : mtb.a;
    if (meine <= fremde) setsLost += 1;
  }

  const bonus = won ? (setsLost === 0 ? 9 : 3) : 0;
  const total = lines.reduce((sum, line) => sum + line.points, 0) + bonus;

  return {
    match,
    opponent: (isA ? match.sideB : match.sideA) ?? '',
    status,
    result: formatResult(match),
    won,
    lines,
    bonus,
    total,
  };
}
