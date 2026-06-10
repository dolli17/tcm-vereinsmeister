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

    CREATE TABLE IF NOT EXISTS reset_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );

    -- Verhindert doppelte Erinnerungs-Mails pro Spiel & Monat.
    CREATE TABLE IF NOT EXISTS reminders_sent (
      match_key TEXT NOT NULL,
      monat     TEXT NOT NULL,
      sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (match_key, monat)
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

    CREATE INDEX IF NOT EXISTS idx_results_status ON results (status);
    CREATE INDEX IF NOT EXISTS idx_results_fixture
      ON results (wettbewerb, gruppe, runde, match_nr);

    -- ── Mehrjahres-Modell: Saisons, Konkurrenzen, Teilnehmer, Paarungen ──────
    CREATE TABLE IF NOT EXISTS seasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      jahr       INTEGER NOT NULL,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'aktiv',   -- 'aktiv' | 'archiviert'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      slug       TEXT NOT NULL,                   -- z.B. 'herren','damen','doppel'
      name       TEXT NOT NULL,                   -- Anzeigename 'Herren Einzel'
      art        TEXT NOT NULL,                   -- 'einzel' | 'doppel' (Spieler pro Seite)
      modus      TEXT NOT NULL,                   -- 'gruppe' | 'ko'
      sort       INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'aktiv',
      UNIQUE (season_id, slug)
    );

    CREATE TABLE IF NOT EXISTS competition_players (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      player_name    TEXT NOT NULL,
      gruppe         INTEGER,                     -- nur Gruppen-Modus
      gesetzt        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (competition_id, player_name)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      gruppe         INTEGER,                     -- Gruppen-Modus
      runde          TEXT,                        -- KO-Modus
      monat          TEXT,                        -- optionaler Fälligkeits-/Anzeigemonat
      nr             INTEGER NOT NULL,
      side_a         TEXT,                        -- "Name" | "Name1 / Name2" | 'BYE' | NULL(offen)
      side_b         TEXT,
      termin         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_comp ON matches (competition_id);

    -- Selbst-Anmeldung zur Saison: Spieler melden sich pro Konkurrenz, der Admin
    -- übernimmt die Meldungen anschließend in competition_players.
    CREATE TABLE IF NOT EXISTS registrations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      player_name    TEXT NOT NULL,
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notiz          TEXT,                        -- z. B. Wunschpartner im Doppel
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (competition_id, player_name)
    );

    -- Terminvorschläge: ein Spieler schlägt vor, die Gegenseite bestätigt;
    -- bei Annahme wird matches.termin gesetzt.
    CREATE TABLE IF NOT EXISTS termin_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      termin      TEXT NOT NULL,                 -- ISO 'YYYY-MM-DDTHH:MM'
      status      TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'accepted'|'declined'|'superseded'
      proposed_by INTEGER REFERENCES users(id),
      decided_by  INTEGER REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_termin_match ON termin_proposals (match_id);

    -- Protokoll für nachvollziehbare Eingriffe (Admin-Aktionen, Ergebnis-Entscheidungen).
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      user_label TEXT,                  -- E-Mail zum Zeitpunkt der Aktion (übersteht User-Löschung)
      action     TEXT NOT NULL,
      detail     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Privater Casual-Bereich: lockere Duelle (außerhalb der VM) für Head-to-Head.
    -- Personen referenzieren den globalen Spielerstamm (players.name) namensbasiert.
    CREATE TABLE IF NOT EXISTS casual_matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      datum      TEXT,                  -- ISO-Datum (optional)
      player_a   TEXT NOT NULL,
      player_b   TEXT NOT NULL,
      satz1      TEXT,
      satz2      TEXT,
      mtb        TEXT,
      sieger     TEXT NOT NULL,         -- 'A' | 'B'
      notiz      TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration für bestehende DBs: password_hash nachrüsten, falls Spalte fehlt.
  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!userCols.some((c) => c.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  // Casual-Zugriff (Flag für den versteckten Head-to-Head-Bereich).
  if (!userCols.some((c) => c.name === 'casual_access')) {
    db.exec('ALTER TABLE users ADD COLUMN casual_access INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: Meldefenster pro Saison (Selbst-Anmeldung der Spieler).
  const seasonCols = db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[];
  if (!seasonCols.some((c) => c.name === 'anmeldung_offen')) {
    db.exec('ALTER TABLE seasons ADD COLUMN anmeldung_offen INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: KO-Automatik — strukturelle Referenz auf die Vorrunden-Matches,
  // deren Sieger in dieses Match vorrücken ("Sieger Match N" wird nur angezeigt).
  const matchCols = db.prepare('PRAGMA table_info(matches)').all() as { name: string }[];
  if (!matchCols.some((c) => c.name === 'source_match_a')) {
    db.exec('ALTER TABLE matches ADD COLUMN source_match_a INTEGER REFERENCES matches(id)');
  }
  if (!matchCols.some((c) => c.name === 'source_match_b')) {
    db.exec('ALTER TABLE matches ADD COLUMN source_match_b INTEGER REFERENCES matches(id)');
  }

  // Migration: results.match_id nachrüsten (Verknüpfung zu matches.id).
  const resultCols = db.prepare('PRAGMA table_info(results)').all() as { name: string }[];
  if (!resultCols.some((c) => c.name === 'match_id')) {
    db.exec('ALTER TABLE results ADD COLUMN match_id INTEGER REFERENCES matches(id)');
  }
  // Migration: Ergebnistyp ('gespielt' | 'wo' | 'aufgabe') für kampflose/abgebrochene Spiele.
  if (!resultCols.some((c) => c.name === 'ergebnis_typ')) {
    db.exec("ALTER TABLE results ADD COLUMN ergebnis_typ TEXT NOT NULL DEFAULT 'gespielt'");
  }

  // Der frühere Unique-Index lag auf (wettbewerb,gruppe,runde,match_nr) und würde
  // gleiche Paarungs-Schlüssel über mehrere Saisons hinweg fälschlich kollidieren
  // lassen. Eindeutigkeit gilt jetzt pro match_id.
  db.exec(`
    DROP INDEX IF EXISTS idx_results_confirmed_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_results_confirmed_match
      ON results (match_id) WHERE status = 'confirmed' AND match_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_results_match ON results (match_id);
  `);
}
