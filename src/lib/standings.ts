import einzelData from '../data/einzel.json';
import spielerData from '../data/spieler.json';

export type Monat = 'Mai' | 'Juni' | 'Juli';
export type Sieger = 'A' | 'B' | null;

export type Match = {
  nr: number;
  gruppe: number;
  monat: Monat;
  spielerA: string;
  spielerB: string;
  termin: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: Sieger;
};

export type Spieler = {
  name: string;
  gruppe: number;
  gesetzt: boolean;
};

export type StandingRow = {
  name: string;
  gesetzt: boolean;
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

const ALL_MATCHES = einzelData.matches as Match[];
const ALL_SPIELER = spielerData.einzel as Spieler[];

function parseSet(set: string | null): { a: number; b: number } | null {
  if (!set) return null;
  const m = set.match(/^(\d+)[:\-](\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

export function isMatchPlayed(match: Match): boolean {
  return match.sieger === 'A' || match.sieger === 'B';
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

function playerStats(match: Match, name: string): PlayerStat | null {
  if (!isMatchPlayed(match)) return null;
  const istA = match.spielerA === name;
  const istB = match.spielerB === name;
  if (!istA && !istB) return null;

  const stat: PlayerStat = {
    saetzeGewonnen: 0,
    saetzeVerloren: 0,
    spieleGewonnen: 0,
    spieleVerloren: 0,
    hatGewonnen: match.sieger === (istA ? 'A' : 'B'),
    punkte: 0,
  };

  for (const setStr of [match.satz1, match.satz2]) {
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

  const mtb = parseSet(match.mtb);
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

export function computeStandings(gruppe: number): StandingRow[] {
  const spieler = ALL_SPIELER.filter((s) => s.gruppe === gruppe);
  const matches = ALL_MATCHES.filter((m) => m.gruppe === gruppe);

  const rows: StandingRow[] = spieler.map((s) => ({
    name: s.name,
    gesetzt: s.gesetzt,
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
    if (!isMatchPlayed(m)) continue;
    for (const name of [m.spielerA, m.spielerB]) {
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

function compareRows(a: StandingRow, b: StandingRow, matches: Match[], allRows: StandingRow[]): number {
  if (a.punkte !== b.punkte) return b.punkte - a.punkte;

  const tied = allRows.filter((r) => r.punkte === a.punkte);
  if (tied.length >= 2) {
    const tiedNames = new Set(tied.map((r) => r.name));
    const tiedMatches = matches.filter(
      (m) => tiedNames.has(m.spielerA) && tiedNames.has(m.spielerB) && isMatchPlayed(m),
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

function h2hAggregate(name: string, matches: Match[]) {
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

export function getMatches(gruppe: number, monat?: Monat): Match[] {
  let m = ALL_MATCHES.filter((x) => x.gruppe === gruppe);
  if (monat) m = m.filter((x) => x.monat === monat);
  return m.slice().sort((a, b) => a.nr - b.nr);
}

export function getAllMatches(monat?: Monat): Match[] {
  return monat ? ALL_MATCHES.filter((x) => x.monat === monat) : ALL_MATCHES.slice();
}

export function getGruppen(): number[] {
  return Array.from(new Set(ALL_SPIELER.map((s) => s.gruppe))).sort((a, b) => a - b);
}

export function getSpielerOfGruppe(gruppe: number): Spieler[] {
  return ALL_SPIELER.filter((s) => s.gruppe === gruppe);
}

export function formatResult(m: Match): string {
  if (!isMatchPlayed(m)) return '';
  const parts: string[] = [];
  if (m.satz1) parts.push(m.satz1);
  if (m.satz2) parts.push(m.satz2);
  if (m.mtb) parts.push(m.mtb);
  return parts.join(' · ');
}

export function matchStatus(m: Match): 'gespielt' | 'terminiert' | 'offen' {
  if (isMatchPlayed(m)) return 'gespielt';
  if (m.termin) return 'terminiert';
  return 'offen';
}
