// Selbst-Seeding beim ersten Start: Spielernamen aus den Fixtures + die bereits in
// den JSON eingetragenen Ergebnisse als 'confirmed'. Idempotent — läuft nur, wenn
// die jeweilige Tabelle leer ist. Admin-Accounts werden bei jedem Start sichergestellt.
import type Database from 'better-sqlite3';
import {
  EINZEL_SPIELER,
  DAMEN_EINZEL_SPIELER,
  RAW_EINZEL,
  RAW_DAMEN_EINZEL,
  RAW_DOPPEL,
  RAW_DAMEN_DOPPEL,
  RAW_MIXED,
  type DoppelMatch,
  type Match,
  type MixedMatch,
} from './fixtures';
import telefonnummern from '../data/telefonnummern.json';

const PHONE_BOOK = telefonnummern as Record<string, string>;

function teamPlayers(team: string | null): string[] {
  if (!team || team === 'BYE') return [];
  return team.split('/').map((p) => p.trim());
}
const isPlaceholder = (name: string) => /^Sieger\s/i.test(name);

export function runSeed(db: Database.Database): void {
  seedPlayers(db);
  seedConfirmedResults(db);
  ensureAdmins(db);
}

function seedPlayers(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO players (name, konkurrenz, gruppe, gesetzt, telefon)
     VALUES (@name, @konkurrenz, @gruppe, @gesetzt, @telefon)`,
  );
  const tx = db.transaction(() => {
    for (const s of EINZEL_SPIELER) {
      insert.run({ name: s.name, konkurrenz: 'herren', gruppe: s.gruppe, gesetzt: s.gesetzt ? 1 : 0, telefon: s.telefon ?? PHONE_BOOK[s.name] ?? null });
    }
    for (const s of DAMEN_EINZEL_SPIELER) {
      insert.run({ name: s.name, konkurrenz: 'damen', gruppe: s.gruppe, gesetzt: s.gesetzt ? 1 : 0, telefon: s.telefon ?? PHONE_BOOK[s.name] ?? null });
    }
    // Doppel-/Mixed-Spieler ohne Einzel-Stammdaten (konkurrenz/gruppe = null).
    const teamNames = new Set<string>();
    for (const m of [...RAW_DOPPEL, ...RAW_DAMEN_DOPPEL]) {
      for (const p of [...teamPlayers(m.doppelA), ...teamPlayers(m.doppelB)]) teamNames.add(p);
    }
    for (const m of RAW_MIXED) {
      for (const p of [...teamPlayers(m.teamA), ...teamPlayers(m.teamB)]) teamNames.add(p);
    }
    for (const name of teamNames) {
      if (isPlaceholder(name)) continue;
      insert.run({ name, konkurrenz: null, gruppe: null, gesetzt: 0, telefon: PHONE_BOOK[name] ?? null });
    }
  });
  tx();
}

function seedConfirmedResults(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number }).n;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO results (wettbewerb, gruppe, runde, match_nr, satz1, satz2, mtb, sieger, status, decided_at)
     VALUES (@wettbewerb, @gruppe, @runde, @match_nr, @satz1, @satz2, @mtb, @sieger, 'confirmed', datetime('now'))`,
  );
  const isPlayed = (m: { sieger: string | null }) => m.sieger === 'A' || m.sieger === 'B';

  const tx = db.transaction(() => {
    const seedEinzel = (matches: Match[], wettbewerb: 'herren' | 'damen') => {
      for (const m of matches) {
        if (!isPlayed(m)) continue;
        insert.run({ wettbewerb, gruppe: m.gruppe, runde: null, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
      }
    };
    const seedDoppel = (matches: DoppelMatch[], wettbewerb: 'doppel' | 'damen-doppel') => {
      for (const m of matches) {
        if (!isPlayed(m)) continue;
        insert.run({ wettbewerb, gruppe: null, runde: m.runde, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
      }
    };
    seedEinzel(RAW_EINZEL, 'herren');
    seedEinzel(RAW_DAMEN_EINZEL, 'damen');
    seedDoppel(RAW_DOPPEL, 'doppel');
    seedDoppel(RAW_DAMEN_DOPPEL, 'damen-doppel');
    for (const m of RAW_MIXED as MixedMatch[]) {
      if (!isPlayed(m)) continue;
      insert.run({ wettbewerb: 'mixed', gruppe: null, runde: m.runde, match_nr: m.nr, satz1: m.satz1, satz2: m.satz2, mtb: m.mtb, sieger: m.sieger });
    }
  });
  tx();
}

function ensureAdmins(db: Database.Database): void {
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return;

  const upsert = db.prepare(
    `INSERT INTO users (email, role, claim_status) VALUES (?, 'admin', 'approved')
     ON CONFLICT(email) DO UPDATE SET role = 'admin'`,
  );
  const tx = db.transaction(() => {
    for (const email of emails) upsert.run(email);
  });
  tx();
}
