// Logik rund um die Ergebnis-Eintragung durch Spieler:innen.
import { getDb } from './db';
import {
  RAW_EINZEL,
  RAW_DAMEN_EINZEL,
  RAW_DOPPEL,
  RAW_DAMEN_DOPPEL,
  RAW_MIXED,
  matchKey,
  teamPlayers,
  type Wettbewerb,
} from './fixtures';

export type ResultStatus = 'open' | 'pending' | 'confirmed' | 'rejected';

export type PlayerMatch = {
  wettbewerb: Wettbewerb;
  wettbewerbLabel: string;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  meineSeite: 'A' | 'B';
  partner: string[];
  gegner: string[];
  status: ResultStatus;
  result: string | null;
  sieger: 'A' | 'B' | null;
  ichGewonnen: boolean | null;
  submittedByMe: boolean;
  rejectReason: string | null;
  canEnter: boolean;
  canDecide: boolean;
  resultId: number | null;
};

const WETTBEWERB_LABEL: Record<Wettbewerb, string> = {
  herren: 'Herren Einzel',
  damen: 'Damen Einzel',
  doppel: 'Herren Doppel',
  'damen-doppel': 'Damen Doppel',
  mixed: 'Mixed Doppel',
};

type DbResult = {
  id: number;
  status: ResultStatus;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B' | null;
  submitted_by: number | null;
  submitter_name: string | null;
  reject_reason: string | null;
};

function formatResult(r: { satz1: string | null; satz2: string | null; mtb: string | null }): string {
  return [r.satz1, r.satz2, r.mtb].filter(Boolean).join(' · ');
}

// Wählt den relevantesten Ergebnis-Datensatz pro Fixture: confirmed > pending > rejected.
function relevantResultMap(): Map<string, DbResult> {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.wettbewerb, r.gruppe, r.runde, r.match_nr, r.status, r.satz1, r.satz2, r.mtb, r.sieger,
              r.submitted_by, u.player_name AS submitter_name, r.reject_reason, r.created_at
       FROM results r LEFT JOIN users u ON u.id = r.submitted_by ORDER BY r.created_at ASC`,
    )
    .all() as (DbResult & { wettbewerb: string; gruppe: number | null; runde: string | null; match_nr: number })[];
  const rank: Record<ResultStatus, number> = { confirmed: 3, pending: 2, rejected: 1, open: 0 };
  const map = new Map<string, DbResult>();
  for (const r of rows) {
    const key = matchKey(r.wettbewerb as Wettbewerb, { gruppe: r.gruppe, runde: r.runde, nr: r.match_nr });
    const existing = map.get(key);
    if (!existing || rank[r.status] >= rank[existing.status]) map.set(key, r);
  }
  return map;
}

type RawFixture = { wettbewerb: Wettbewerb; gruppe: number | null; runde: string | null; nr: number; sideA: string[]; sideB: string[] };

function allFixtures(): RawFixture[] {
  const list: RawFixture[] = [];
  for (const m of RAW_EINZEL) list.push({ wettbewerb: 'herren', gruppe: m.gruppe, runde: null, nr: m.nr, sideA: [m.spielerA], sideB: [m.spielerB] });
  for (const m of RAW_DAMEN_EINZEL) list.push({ wettbewerb: 'damen', gruppe: m.gruppe, runde: null, nr: m.nr, sideA: [m.spielerA], sideB: [m.spielerB] });
  for (const m of RAW_DOPPEL) list.push({ wettbewerb: 'doppel', gruppe: null, runde: m.runde, nr: m.nr, sideA: teamPlayers(m.doppelA), sideB: teamPlayers(m.doppelB) });
  for (const m of RAW_DAMEN_DOPPEL) list.push({ wettbewerb: 'damen-doppel', gruppe: null, runde: m.runde, nr: m.nr, sideA: teamPlayers(m.doppelA), sideB: teamPlayers(m.doppelB) });
  for (const m of RAW_MIXED) list.push({ wettbewerb: 'mixed', gruppe: null, runde: m.runde, nr: m.nr, sideA: teamPlayers(m.teamA), sideB: teamPlayers(m.teamB) });
  return list;
}

// Alle Spiele einer Spielerin / eines Spielers mit aktuellem Status.
export function getPlayerMatches(playerName: string, userId: number): PlayerMatch[] {
  const resultMap = relevantResultMap();
  const out: PlayerMatch[] = [];

  for (const f of allFixtures()) {
    const inA = f.sideA.includes(playerName);
    const inB = f.sideB.includes(playerName);
    if (!inA && !inB) continue;
    // Freilose und noch unbestimmte KO-Slots überspringen.
    if (f.sideA.length === 0 || f.sideB.length === 0) continue;

    const meineSeite: 'A' | 'B' = inA ? 'A' : 'B';
    const ownSide = inA ? f.sideA : f.sideB;
    const otherSide = inA ? f.sideB : f.sideA;
    const res = resultMap.get(matchKey(f.wettbewerb, { gruppe: f.gruppe, runde: f.runde, nr: f.nr }));
    const status: ResultStatus = res ? res.status : 'open';
    const ichGewonnen = res && res.sieger ? res.sieger === meineSeite : null;
    // Gegner darf ein offenes (pending) Ergebnis bestätigen/ablehnen, wenn der/die
    // Eintragende auf der anderen Seite steht.
    const submitterOnOtherSide = res?.submitter_name ? otherSide.includes(res.submitter_name) : false;
    const canDecide = status === 'pending' && res?.submitted_by !== userId && submitterOnOtherSide;

    out.push({
      wettbewerb: f.wettbewerb,
      wettbewerbLabel: WETTBEWERB_LABEL[f.wettbewerb],
      gruppe: f.gruppe,
      runde: f.runde,
      nr: f.nr,
      sideA: f.sideA,
      sideB: f.sideB,
      meineSeite,
      partner: ownSide.filter((p) => p !== playerName),
      gegner: otherSide,
      status,
      result: res && (res.status === 'confirmed' || res.status === 'pending') ? formatResult(res) : null,
      sieger: res?.sieger ?? null,
      ichGewonnen,
      submittedByMe: res?.submitted_by === userId,
      rejectReason: res?.status === 'rejected' ? res.reject_reason : null,
      // Abgelehnte Partien gehen NICHT zurück an die Spieler — sie werden vom Admin geklärt.
      canEnter: status === 'open',
      canDecide,
      resultId: res?.id ?? null,
    });
  }
  return out;
}

// ── Score-Validierung ──────────────────────────────────────────────────────
function parseSet(s: string): { a: number; b: number } | null {
  const m = s.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

export type ScoreInput = { satz1: string; satz2: string; mtb?: string | null };
export type ValidScore = { satz1: string; satz2: string; mtb: string | null; sieger: 'A' | 'B' };

// Validiert die Eingabe und leitet den Sieger aus den Sätzen ab (Client-Sieger wird ignoriert).
export function validateScore(input: ScoreInput): { ok: true; score: ValidScore } | { ok: false; error: string } {
  const s1 = parseSet(input.satz1 ?? '');
  const s2 = parseSet(input.satz2 ?? '');
  if (!s1 || !s2) return { ok: false, error: 'Bitte beide Sätze im Format z. B. 6:3 eingeben.' };

  let winsA = (s1.a > s1.b ? 1 : 0) + (s2.a > s2.b ? 1 : 0);
  let winsB = (s1.a < s1.b ? 1 : 0) + (s2.a < s2.b ? 1 : 0);

  const norm = (set: { a: number; b: number }) => `${set.a}:${set.b}`;
  let mtb: string | null = null;

  if (winsA === 1 && winsB === 1) {
    const m = parseSet(input.mtb ?? '');
    if (!m) return { ok: false, error: 'Bei 1:1 Sätzen bitte den Match-Tiebreak eingeben (z. B. 10:7).' };
    mtb = norm(m);
    if (m.a > m.b) winsA += 1;
    else if (m.b > m.a) winsB += 1;
    else return { ok: false, error: 'Der Match-Tiebreak darf nicht unentschieden sein.' };
  }

  if (winsA === winsB) return { ok: false, error: 'Das Ergebnis ergibt keinen eindeutigen Sieger.' };
  const sieger: 'A' | 'B' = winsA > winsB ? 'A' : 'B';
  return { ok: true, score: { satz1: norm(s1), satz2: norm(s2), mtb, sieger } };
}
