import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runSeed } from './seed';

// SQLite-Datei: lokal ./data/vm.sqlite, im Container über DATABASE_PATH (Volume).
const DB_PATH = process.env.DATABASE_PATH || './data/vm.sqlite';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  runSeed(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      konkurrenz TEXT,            -- 'herren' | 'damen' (nur für Einzel-Stammdaten)
      gruppe    INTEGER,
      gesetzt   INTEGER DEFAULT 0,
      telefon   TEXT,
      UNIQUE (name)
    );

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL UNIQUE,
      password_hash TEXT,         -- scrypt-Hash; null bis Passwort gesetzt
      player_name TEXT,           -- beanspruchter Spielername (null bis Freigabe)
      role        TEXT NOT NULL DEFAULT 'player',   -- 'player' | 'admin'
      claim_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,         -- zufälliges Session-Token (im Cookie)
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS results (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      wettbewerb   TEXT NOT NULL,   -- 'herren'|'damen'|'doppel'|'damen-doppel'|'mixed'
      gruppe       INTEGER,
      runde        TEXT,
      match_nr     INTEGER NOT NULL,
      satz1        TEXT,
      satz2        TEXT,
      mtb          TEXT,
      sieger       TEXT,            -- 'A' | 'B'
      status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'confirmed'|'rejected'
      submitted_by INTEGER REFERENCES users(id),
      confirm_token TEXT UNIQUE,
      reject_reason TEXT,
      decided_by   INTEGER REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at   TEXT
    );

    -- Pro Fixture darf es nur EIN bestätigtes Ergebnis geben.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_results_confirmed_unique
      ON results (wettbewerb, IFNULL(gruppe,-1), IFNULL(runde,''), match_nr)
      WHERE status = 'confirmed';

    CREATE INDEX IF NOT EXISTS idx_results_status ON results (status);
    CREATE INDEX IF NOT EXISTS idx_results_fixture
      ON results (wettbewerb, gruppe, runde, match_nr);
  `);

  // Migration für bestehende DBs: password_hash nachrüsten, falls Spalte fehlt.
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
}
