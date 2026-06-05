// Effektive Match-Daten = Fixtures (JSON) mit überlagerten, *bestätigten*
// Ergebnissen aus der DB. Die in den JSON gespeicherten Ergebnisfelder werden zur
// Laufzeit ignoriert (die DB ist maßgeblich); sie dienen nur als Seed-Quelle.
import { getDb } from './db';
import {
  RAW_EINZEL,
  RAW_DAMEN_EINZEL,
  RAW_DOPPEL,
  RAW_DAMEN_DOPPEL,
  RAW_MIXED,
  matchKey,
  type Match,
  type DoppelMatch,
  type MixedMatch,
  type Konkurrenz,
  type Sieger,
  type Wettbewerb,
} from './fixtures';

type ResultRow = {
  wettbewerb: string;
  gruppe: number | null;
  runde: string | null;
  match_nr: number;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: string | null;
};

type ResultFields = { satz1: string | null; satz2: string | null; mtb: string | null; sieger: Sieger };

function confirmedMap(): Map<string, ResultFields> {
  const rows = getDb()
    .prepare(`SELECT wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger
              FROM results WHERE status = 'confirmed'`)
    .all() as ResultRow[];
  const map = new Map<string, ResultFields>();
  for (const r of rows) {
    const key = matchKey(r.wettbewerb as Wettbewerb, { gruppe: r.gruppe, runde: r.runde, nr: r.match_nr });
    map.set(key, { satz1: r.satz1, satz2: r.satz2, mtb: r.mtb, sieger: (r.sieger as Sieger) ?? null });
  }
  return map;
}

// Setzt Ergebnisfelder auf das DB-Ergebnis (oder leert sie, wenn keins vorliegt).
function withResult<T extends { satz1: string | null; satz2: string | null; mtb: string | null; sieger: Sieger }>(
  fixture: T,
  res: ResultFields | undefined,
): T {
  return { ...fixture, satz1: res?.satz1 ?? null, satz2: res?.satz2 ?? null, mtb: res?.mtb ?? null, sieger: res?.sieger ?? null };
}

export function getEinzelMatches(konkurrenz: Konkurrenz): Match[] {
  const map = confirmedMap();
  const raw = konkurrenz === 'damen' ? RAW_DAMEN_EINZEL : RAW_EINZEL;
  return raw.map((m) => withResult(m, map.get(matchKey(konkurrenz, { gruppe: m.gruppe, nr: m.nr }))));
}

export function getDoppelMatches(wettbewerb: 'doppel' | 'damen-doppel'): DoppelMatch[] {
  const map = confirmedMap();
  const raw = wettbewerb === 'damen-doppel' ? RAW_DAMEN_DOPPEL : RAW_DOPPEL;
  return raw.map((m) => withResult(m, map.get(matchKey(wettbewerb, { runde: m.runde, nr: m.nr }))));
}

export function getMixedMatches(): MixedMatch[] {
  const map = confirmedMap();
  return RAW_MIXED.map((m) => withResult(m, map.get(matchKey('mixed', { runde: m.runde, nr: m.nr }))));
}

// Mixed-Doppel gruppiert nach Runde (für die KO-Baum-Ansicht), Reihenfolge wie Fixture.
export function getMixedRunden(): { name: string; matches: MixedMatch[] }[] {
  const runden: { name: string; matches: MixedMatch[] }[] = [];
  for (const m of getMixedMatches()) {
    let r = runden.find((x) => x.name === m.runde);
    if (!r) {
      r = { name: m.runde, matches: [] };
      runden.push(r);
    }
    r.matches.push(m);
  }
  return runden;
}
