// Ewige Vereins-Rangliste: ELO über alle bestätigten VM-Spiele aller Saisons
// (Einzel und Doppel; Doppel mit Team-Durchschnitt). Casual-Duelle bleiben
// bewusst außen vor — der Casual-Bereich ist privat.
import { getDb } from './db';
import { teamPlayers } from './tournament';

const K = 32;
const START = 1000;

export type EloRow = {
  platz: number;
  name: string;
  elo: number;
  spiele: number;
  siege: number;
};

type Duel = { winners: string[]; losers: string[] };

function collectDuels(): Duel[] {
  const rows = getDb()
    .prepare(
      `SELECT r.sieger, m.side_a, m.side_b
       FROM results r JOIN matches m ON m.id = r.match_id
       WHERE r.status = 'confirmed' AND r.match_id IS NOT NULL
       ORDER BY COALESCE(r.decided_at, r.created_at), r.id`,
    )
    .all() as { sieger: 'A' | 'B'; side_a: string | null; side_b: string | null }[];

  const out: Duel[] = [];
  for (const r of rows) {
    const a = teamPlayers(r.side_a);
    const b = teamPlayers(r.side_b);
    if (a.length === 0 || b.length === 0) continue; // Freilos/Platzhalter
    out.push(r.sieger === 'A' ? { winners: a, losers: b } : { winners: b, losers: a });
  }
  return out;
}

export function computeEloRanking(): EloRow[] {
  const elo = new Map<string, number>();
  const spiele = new Map<string, number>();
  const siege = new Map<string, number>();
  const get = (n: string) => elo.get(n) ?? START;

  for (const d of collectDuels()) {
    const ra = d.winners.reduce((s, n) => s + get(n), 0) / d.winners.length;
    const rb = d.losers.reduce((s, n) => s + get(n), 0) / d.losers.length;
    const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
    const delta = K * (1 - expected);
    for (const n of d.winners) {
      elo.set(n, get(n) + delta);
      spiele.set(n, (spiele.get(n) ?? 0) + 1);
      siege.set(n, (siege.get(n) ?? 0) + 1);
    }
    for (const n of d.losers) {
      elo.set(n, get(n) - delta);
      spiele.set(n, (spiele.get(n) ?? 0) + 1);
    }
  }

  const rows = Array.from(elo.entries())
    .map(([name, value]) => ({
      platz: 0,
      name,
      elo: Math.round(value),
      spiele: spiele.get(name) ?? 0,
      siege: siege.get(name) ?? 0,
    }))
    .sort((a, b) => b.elo - a.elo || b.siege - a.siege || a.name.localeCompare(b.name, 'de'));
  rows.forEach((r, i) => (r.platz = i + 1));
  return rows;
}

export function getEloFor(name: string): EloRow | null {
  return computeEloRanking().find((r) => r.name === name) ?? null;
}
