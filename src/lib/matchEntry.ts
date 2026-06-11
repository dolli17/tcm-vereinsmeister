// Logik rund um die Ergebnis-Eintragung (Spieler & Admin) sowie überfällige
// Spiele. Arbeitet auf der aktiven Saison; Ergebnisse hängen über match_id an den
// Paarungen (matches).
import { getDb } from './db';
import {
  getActiveSeason,
  getCompetition,
  getCompetitions,
  getEnrichedMatches,
  getMatchRows,
  getSeason,
  monthIndex,
  syncBracketForMatch,
  teamPlayers,
  type Competition,
  type EnrichedMatch,
  type ErgebnisTyp,
} from './tournament';
import { logAction } from './audit';

export type ResultStatus = 'open' | 'pending' | 'confirmed' | 'rejected';

// Auflösung einer Paarung auf Spielernamen — für Teilnahme-Prüfung & Mails.
export type FixtureRef = {
  matchId: number;
  competitionId: number;
  wettbewerb: string; // slug
  wettbewerbLabel: string; // Anzeigename der Konkurrenz
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  seasonId: number;
  seasonStatus: string; // 'aktiv' | 'archiviert' — Eintragung nur in aktiver Saison
};

export function findFixtureById(matchId: number): FixtureRef | null {
  const row = getDb()
    .prepare('SELECT * FROM matches WHERE id = ?')
    .get(matchId) as
    | { id: number; competition_id: number; gruppe: number | null; runde: string | null; nr: number; side_a: string | null; side_b: string | null }
    | undefined;
  if (!row) return null;
  const comp = getCompetition(row.competition_id);
  if (!comp) return null;
  const season = getSeason(comp.season_id);
  if (!season) return null;
  return {
    matchId: row.id,
    competitionId: comp.id,
    wettbewerb: comp.slug,
    wettbewerbLabel: comp.name,
    gruppe: row.gruppe,
    runde: row.runde,
    nr: row.nr,
    sideA: teamPlayers(row.side_a),
    sideB: teamPlayers(row.side_b),
    seasonId: season.id,
    seasonStatus: season.status,
  };
}

export type PlayerMatch = {
  matchId: number;
  wettbewerb: string;
  wettbewerbLabel: string;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  meineSeite: 'A' | 'B';
  partner: string[];
  gegner: string[];
  isBye: boolean;
  // KO-Platzhalter ("Sieger Match 3"): Gegner steht noch nicht fest — kein Freilos.
  gegnerOffen: boolean;
  termin: string | null;
  monat: string | null; // Fälligkeitsmonat (für Überfällig-Hinweise)
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

type DbResult = {
  id: number;
  match_id: number;
  status: ResultStatus;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B' | null;
  ergebnis_typ: ErgebnisTyp;
  submitted_by: number | null;
  submitter_name: string | null;
  reject_reason: string | null;
};

function formatResult(r: { satz1: string | null; satz2: string | null; mtb: string | null; ergebnis_typ?: ErgebnisTyp }): string {
  const base = [r.satz1, r.satz2, r.mtb].filter(Boolean).join(' · ');
  if (r.ergebnis_typ === 'wo') return 'kampflos (w.o.)';
  if (r.ergebnis_typ === 'aufgabe') return base ? `${base} · Aufgabe` : 'Aufgabe';
  return base;
}

// Relevantestes Ergebnis je match_id (confirmed > pending > rejected) für eine Saison.
function relevantResultByMatch(seasonId: number): Map<number, DbResult> {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.match_id, r.status, r.satz1, r.satz2, r.mtb, r.sieger, r.ergebnis_typ,
              r.submitted_by, u.player_name AS submitter_name, r.reject_reason, r.created_at
       FROM results r
       JOIN matches m ON m.id = r.match_id
       JOIN competitions c ON c.id = m.competition_id
       LEFT JOIN users u ON u.id = r.submitted_by
       WHERE c.season_id = ? AND r.match_id IS NOT NULL
       ORDER BY r.created_at ASC`,
    )
    .all(seasonId) as (DbResult & { created_at: string })[];
  const rank: Record<ResultStatus, number> = { confirmed: 3, pending: 2, rejected: 1, open: 0 };
  const map = new Map<number, DbResult>();
  for (const r of rows) {
    const existing = map.get(r.match_id);
    if (!existing || rank[r.status] >= rank[existing.status]) map.set(r.match_id, r);
  }
  return map;
}

type CompMatch = { comp: Competition; m: EnrichedMatch };

function activeCompMatches(seasonId: number): CompMatch[] {
  const out: CompMatch[] = [];
  for (const comp of getCompetitions(seasonId)) {
    for (const m of getEnrichedMatches(comp.id)) out.push({ comp, m });
  }
  return out;
}

// Alle Spiele einer Spielerin / eines Spielers (aktive Saison) mit Status.
export function getPlayerMatches(playerName: string, userId: number, seasonId?: number): PlayerMatch[] {
  const season = seasonId != null ? { id: seasonId } : getActiveSeason();
  if (!season) return [];
  const resultMap = relevantResultByMatch(season.id);
  const out: PlayerMatch[] = [];

  for (const { comp, m } of activeCompMatches(season.id)) {
    const sideA = teamPlayers(m.sideA);
    const sideB = teamPlayers(m.sideB);
    const inA = sideA.includes(playerName);
    const inB = sideB.includes(playerName);
    if (!inA && !inB) continue;

    const meineSeite: 'A' | 'B' = inA ? 'A' : 'B';
    const ownSide = inA ? sideA : sideB;
    const otherSide = inA ? sideB : sideA;
    if (ownSide.length === 0) continue;
    const rawOther = inA ? m.sideB : m.sideA;
    const isBye = otherSide.length === 0 && (!rawOther || rawOther === 'BYE');
    const gegnerOffen = otherSide.length === 0 && !isBye;
    const res = resultMap.get(m.id);
    const status: ResultStatus = res ? res.status : 'open';
    const ichGewonnen = res && res.sieger ? res.sieger === meineSeite : null;
    const submitterOnOtherSide = res?.submitter_name ? otherSide.includes(res.submitter_name) : false;
    const canDecide = status === 'pending' && res?.submitted_by !== userId && submitterOnOtherSide;

    out.push({
      matchId: m.id,
      wettbewerb: comp.slug,
      wettbewerbLabel: comp.name,
      gruppe: m.gruppe,
      runde: m.runde,
      nr: m.nr,
      sideA,
      sideB,
      meineSeite,
      partner: ownSide.filter((p) => p !== playerName),
      gegner: otherSide,
      isBye,
      gegnerOffen,
      termin: m.termin,
      monat: m.monat,
      status,
      result: res && (res.status === 'confirmed' || res.status === 'pending') ? formatResult(res) : null,
      sieger: res?.sieger ?? null,
      ichGewonnen,
      submittedByMe: res?.submitted_by === userId,
      rejectReason: res?.status === 'rejected' ? res.reject_reason : null,
      canEnter: status === 'open' && otherSide.length > 0,
      canDecide,
      resultId: res?.id ?? null,
    });
  }
  return out;
}

export type AdminFixture = {
  matchId: number;
  wettbewerb: string;
  wettbewerbLabel: string;
  gruppe: number | null;
  runde: string | null;
  nr: number;
  sideA: string[];
  sideB: string[];
  status: ResultStatus;
  satz1: string | null;
  satz2: string | null;
  mtb: string | null;
  sieger: 'A' | 'B' | null;
  ergebnisTyp: ErgebnisTyp;
  result: string | null;
  resultId: number | null;
};

// Alle Paarungen (ohne Freilose) mit aktuellem Ergebnis/Status — Admin-Verwaltung.
export function getAllFixturesWithStatus(seasonId?: number): AdminFixture[] {
  const season = seasonId != null ? { id: seasonId } : getActiveSeason();
  if (!season) return [];
  const resultMap = relevantResultByMatch(season.id);
  const out: AdminFixture[] = [];
  for (const { comp, m } of activeCompMatches(season.id)) {
    const sideA = teamPlayers(m.sideA);
    const sideB = teamPlayers(m.sideB);
    if (sideA.length === 0 || sideB.length === 0) continue;
    const res = resultMap.get(m.id);
    out.push({
      matchId: m.id,
      wettbewerb: comp.slug,
      wettbewerbLabel: comp.name,
      gruppe: m.gruppe,
      runde: m.runde,
      nr: m.nr,
      sideA,
      sideB,
      status: res ? res.status : 'open',
      satz1: res?.satz1 ?? null,
      satz2: res?.satz2 ?? null,
      mtb: res?.mtb ?? null,
      sieger: res?.sieger ?? null,
      ergebnisTyp: res?.ergebnis_typ ?? 'gespielt',
      result: res && (res.status === 'confirmed' || res.status === 'pending') ? formatResult(res) : null,
      resultId: res?.id ?? null,
    });
  }
  return out;
}

// ── Überfällige Spiele (für Admin-Übersicht) ────────────────────────────────
export type OverdueMatch = {
  matchId: number;
  wettbewerbLabel: string;
  context: string;
  nr: number;
  sideA: string[];
  sideB: string[];
  dueName: string;
};

// Offene Spiele, deren Fälligkeitsmonat (Saisonjahr + match.monat) vor dem
// aktuellen Monat liegt — jahresübergreifend, damit eine im Vorjahr gestartete
// Saison nicht ab Januar "unauffällig" wird.
export function getOverdueMatches(now: Date = new Date(), seasonId?: number): OverdueMatch[] {
  const season = seasonId != null ? getSeason(seasonId) : getActiveSeason();
  if (!season) return [];
  const curYear = now.getFullYear();
  const cur = now.getMonth() + 1; // 1..12
  const out: OverdueMatch[] = [];
  for (const { comp, m } of activeCompMatches(season.id)) {
    if (m.sieger === 'A' || m.sieger === 'B') continue;
    const a = teamPlayers(m.sideA);
    const b = teamPlayers(m.sideB);
    if (a.length === 0 || b.length === 0) continue;
    if (!m.monat) continue;
    const dueIdx = monthIndex(m.monat) + 1; // monthIndex ist 0-basiert
    if (dueIdx > 12) continue;
    const overdue = season.jahr < curYear || (season.jahr === curYear && dueIdx < cur);
    if (!overdue) continue;
    const context = m.gruppe != null ? `Gruppe ${m.gruppe}` : m.runde ?? '';
    out.push({ matchId: m.id, wettbewerbLabel: comp.name, context, nr: m.nr, sideA: a, sideB: b, dueName: `${m.monat} ${season.jahr}` });
  }
  return out;
}

// ── Admin-Ergebnis setzen/löschen ───────────────────────────────────────────
// Maßgebliche Eintragung (Admin oder API-Token): bestehende Datensätze des
// Spiels werden ersetzt, das Ergebnis ist sofort bestätigt, das KO-Bracket
// wird synchronisiert und die Aktion protokolliert.
export function adminSetResult(
  matchId: number,
  entry: EntryInput,
  admin: { id: number; email: string },
): { ok: true; score: EntryScore; fixture: FixtureRef } | { ok: false; error: string } {
  const fixture = findFixtureById(matchId);
  if (!fixture) return { ok: false, error: 'Unbekanntes Match.' };

  const valid = validateEntry(entry);
  if (!valid.ok) return valid;
  const s = valid.score;

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM results WHERE match_id = ?').run(matchId);
    db.prepare(
      `INSERT INTO results (match_id, wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, ergebnis_typ, status, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'))`,
    ).run(matchId, fixture.wettbewerb, fixture.gruppe, fixture.runde, fixture.nr, s.satz1, s.satz2, s.mtb, s.sieger, s.typ, admin.id);
  });
  tx();
  syncBracketForMatch(matchId);
  const label = `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}`;
  logAction(admin, 'ergebnis_eingetragen', `${label} — ${[s.satz1, s.satz2, s.mtb].filter(Boolean).join(' · ') || s.typ}`);
  return { ok: true, score: s, fixture };
}

export function adminDeleteResult(
  matchId: number,
  admin: { id: number; email: string },
): { ok: true; fixture: FixtureRef } | { ok: false; error: string } {
  const fixture = findFixtureById(matchId);
  if (!fixture) return { ok: false, error: 'Unbekanntes Match.' };
  getDb().prepare('DELETE FROM results WHERE match_id = ?').run(matchId);
  syncBracketForMatch(matchId);
  logAction(admin, 'ergebnis_geloescht', `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}`);
  return { ok: true, fixture };
}

// ── Score-Validierung ──────────────────────────────────────────────────────
// Tolerante Normalisierung von Satz-Eingaben: am Handy fehlt auf der
// Zifferntastatur der Doppelpunkt. Akzeptiert werden alternative Trenner
// (- . , ; Leerzeichen) sowie reine Ziffernfolgen, sofern eindeutig:
// "63"→6:3, "107"→10:7, "712"→7:12, "1210"→12:10. Liefert "a:b" oder null.
export function normalizeSetInput(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const sep = t.match(/^(\d+)\s*[:\-.,;\s]\s*(\d+)$/);
  if (sep) return `${parseInt(sep[1], 10)}:${parseInt(sep[2], 10)}`;
  if (/^\d+$/.test(t)) {
    if (t.length === 2) return `${t[0]}:${t[1]}`;
    if (t.length === 3) {
      const ab = parseInt(t.slice(0, 2), 10);
      const bc = parseInt(t.slice(1), 10);
      if (ab >= 10) return `${ab}:${t[2]}`;
      if (bc >= 10) return `${t[0]}:${bc}`;
      return null;
    }
    if (t.length === 4) return `${parseInt(t.slice(0, 2), 10)}:${parseInt(t.slice(2), 10)}`;
  }
  return null;
}

function parseSet(s: string): { a: number; b: number } | null {
  const norm = normalizeSetInput(s);
  if (!norm) return null;
  const m = norm.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

export type ScoreInput = { satz1: string; satz2: string; mtb?: string | null };
export type ValidScore = { satz1: string; satz2: string; mtb: string | null; sieger: 'A' | 'B' };
// Vereinheitlichte Eintragung inkl. Sonderfälle (kampflos/Aufgabe): Sätze dürfen
// dort fehlen, der Sieger muss explizit angegeben werden.
export type EntryScore = { satz1: string | null; satz2: string | null; mtb: string | null; sieger: 'A' | 'B'; typ: ErgebnisTyp };
export type EntryInput = { typ: string; satz1?: string | null; satz2?: string | null; mtb?: string | null; sieger?: string | null };

// Spiegelt einen Satz-String (z. B. '6:2' → '2:6'). Eingaben erfolgen intuitiv
// aus Sicht des Eintragenden; gespeichert wird immer aus Sicht von Seite A.
export function flipSet(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const norm = normalizeSetInput(t);
  if (!norm) return t; // Unlesbares unverändert lassen — validateEntry meldet den Fehler
  const m = norm.match(/^(\d+):(\d+)$/)!;
  return `${m[2]}:${m[1]}`;
}

export function validateEntry(input: EntryInput): { ok: true; score: EntryScore } | { ok: false; error: string } {
  const typ = ['gespielt', 'wo', 'aufgabe'].includes(input.typ) ? (input.typ as ErgebnisTyp) : 'gespielt';

  if (typ === 'gespielt') {
    const v = validateScore({ satz1: input.satz1 ?? '', satz2: input.satz2 ?? '', mtb: input.mtb });
    return v.ok ? { ok: true, score: { ...v.score, typ } } : v;
  }

  const sieger = input.sieger === 'A' || input.sieger === 'B' ? input.sieger : null;
  if (!sieger) return { ok: false, error: 'Bitte angeben, wer das Spiel gewonnen hat.' };

  if (typ === 'wo') return { ok: true, score: { satz1: null, satz2: null, mtb: null, sieger, typ } };

  // Aufgabe: erfasste Sätze sind optional, müssen aber lesbar sein.
  const parts: (string | null)[] = [];
  for (const raw of [input.satz1, input.satz2, input.mtb]) {
    const t = (raw ?? '').trim();
    if (!t) {
      parts.push(null);
      continue;
    }
    const p = parseSet(t);
    if (!p) return { ok: false, error: 'Sätze bitte im Format z. B. 6:3 eingeben (oder leer lassen).' };
    parts.push(`${p.a}:${p.b}`);
  }
  return { ok: true, score: { satz1: parts[0], satz2: parts[1], mtb: parts[2], sieger, typ } };
}

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
