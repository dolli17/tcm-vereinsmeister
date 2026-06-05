// Zentrale Fixture-Quelle: Spielplan & Paarungen kommen weiterhin aus den
// JSON-Dateien (src/data/*.json). Die *Ergebnisse* werden zur Laufzeit aus der
// Datenbank überlagert (siehe results.ts). Die in den JSON eingetragenen
// Ergebnisse dienen nur noch als einmalige Seed-Quelle (scripts/seed.mjs).
import einzelData from '../data/einzel.json';
import damenEinzelData from '../data/damen-einzel.json';
import doppelData from '../data/doppel.json';
import damenDoppelData from '../data/damen-doppel.json';
import mixedDoppelData from '../data/mixed-doppel.json';
import spielerData from '../data/spieler.json';

export type Monat = 'Mai' | 'Juni' | 'Juli';
export type Sieger = 'A' | 'B' | null;
export type Konkurrenz = 'herren' | 'damen';

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

export type DoppelMatch = {
  runde: string;
  nr: number;
  doppelA: string | null;
  doppelB: string | null;
  termin: string | null;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: Sieger;
};

export type MixedMatch = {
  runde: string;
  nr: number;
  teamA: string | null;
  teamB: string | null;
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
  telefon?: string;
};

// Identifiziert eine konkrete Konkurrenz für die Ergebnis-Überlagerung.
export type Wettbewerb = 'herren' | 'damen' | 'doppel' | 'damen-doppel' | 'mixed';

export const EINZEL_SPIELER = spielerData.einzel as Spieler[];
export const DAMEN_EINZEL_SPIELER = spielerData.damenEinzel as Spieler[];

export const RAW_EINZEL = einzelData.matches as Match[];
export const RAW_DAMEN_EINZEL = damenEinzelData.matches as Match[];
export const RAW_DOPPEL = doppelData.matches as DoppelMatch[];
export const RAW_DAMEN_DOPPEL = damenDoppelData.matches as DoppelMatch[];

// Mixed-Doppel ist ein KO-Baum (runden[].matches[]); flach mit Rundenname.
export const RAW_MIXED: MixedMatch[] = mixedDoppelData.runden.flatMap((runde) =>
  runde.matches.map((m) => ({
    runde: runde.name,
    nr: m.nr,
    teamA: m.teamA ?? null,
    teamB: m.teamB ?? null,
    termin: m.termin ?? null,
    satz1: m.satz1 ?? null,
    satz2: m.satz2 ?? null,
    mtb: m.mtb ?? null,
    sieger: (m.sieger ?? null) as Sieger,
  })),
);

// Eindeutiger Schlüssel pro Fixture für die Ergebnis-Zuordnung in der DB.
export function matchKey(
  wettbewerb: Wettbewerb,
  opts: { gruppe?: number | null; runde?: string | null; nr: number },
): string {
  return [wettbewerb, opts.gruppe ?? '', opts.runde ?? '', opts.nr].join('|');
}

export function teamPlayers(team: string | null): string[] {
  if (!team || team === 'BYE') return [];
  return team.split('/').map((p) => p.trim());
}

export type FixtureRef = {
  wettbewerb: Wettbewerb;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  monat: Monat | null;
  sideA: string[];
  sideB: string[];
};

// Findet ein Fixture (Paarung) anhand seines Schlüssels — Quelle der Wahrheit für
// Teilnehmer-Validierung bei der Ergebnis-Eintragung.
export function findFixture(
  wettbewerb: Wettbewerb,
  opts: { gruppe?: number | null; runde?: string | null; nr: number },
): FixtureRef | null {
  if (wettbewerb === 'herren' || wettbewerb === 'damen') {
    const raw = wettbewerb === 'damen' ? RAW_DAMEN_EINZEL : RAW_EINZEL;
    const m = raw.find((x) => x.gruppe === opts.gruppe && x.nr === opts.nr);
    if (!m) return null;
    return { wettbewerb, gruppe: m.gruppe, runde: null, nr: m.nr, monat: m.monat, sideA: [m.spielerA], sideB: [m.spielerB] };
  }
  if (wettbewerb === 'doppel' || wettbewerb === 'damen-doppel') {
    const raw = wettbewerb === 'damen-doppel' ? RAW_DAMEN_DOPPEL : RAW_DOPPEL;
    const m = raw.find((x) => x.runde === opts.runde && x.nr === opts.nr);
    if (!m) return null;
    return { wettbewerb, gruppe: null, runde: m.runde, nr: m.nr, monat: null, sideA: teamPlayers(m.doppelA), sideB: teamPlayers(m.doppelB) };
  }
  const m = RAW_MIXED.find((x) => x.runde === opts.runde && x.nr === opts.nr);
  if (!m) return null;
  return { wettbewerb, gruppe: null, runde: m.runde, nr: m.nr, monat: null, sideA: teamPlayers(m.teamA), sideB: teamPlayers(m.teamB) };
}
