// Spieler-Stammdaten in der DB (Telefonnummern). Quelle der Wahrheit für die
// Telefon-Anzeige auf der Seite — Spieler können ihre Nummer in den Einstellungen ändern.
import { getDb } from './db';

export function getPhoneMap(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT name, telefon FROM players WHERE telefon IS NOT NULL AND telefon != ''")
    .all() as { name: string; telefon: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.telefon;
  return map;
}

export function getPhone(name: string): string | null {
  const row = getDb().prepare('SELECT telefon FROM players WHERE name = ?').get(name) as { telefon: string | null } | undefined;
  return row?.telefon ?? null;
}

// Setzt die Telefonnummer eines Spielers (leer => entfernt).
export function updatePlayerPhone(name: string, phone: string): void {
  const value = phone.trim() || null;
  getDb().prepare('UPDATE players SET telefon = ? WHERE name = ?').run(value, name);
}

export type Geschlecht = 'm' | 'w';
export type RosterPlayer = { name: string; telefon: string | null; geschlecht: Geschlecht | null; account_email: string | null };

// Globaler Spielerstamm inkl. Hinweis, ob ein freigegebener Account existiert.
export function listPlayers(): RosterPlayer[] {
  return getDb()
    .prepare(
      `SELECT p.name, p.telefon, p.geschlecht,
              (SELECT u.email FROM users u WHERE u.player_name = p.name AND u.claim_status = 'approved' LIMIT 1) AS account_email
       FROM players p ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as RosterPlayer[];
}

export function getGeschlecht(name: string): Geschlecht | null {
  const row = getDb().prepare('SELECT geschlecht FROM players WHERE name = ?').get(name) as
    | { geschlecht: Geschlecht | null }
    | undefined;
  return row?.geschlecht ?? null;
}

// Setzt das Geschlecht; mit onlyIfNull wird ein bereits gepflegter Wert nicht überschrieben.
export function setGeschlecht(name: string, geschlecht: Geschlecht, opts: { onlyIfNull?: boolean } = {}): void {
  if (opts.onlyIfNull) {
    getDb().prepare('UPDATE players SET geschlecht = ? WHERE name = ? AND geschlecht IS NULL').run(geschlecht, name);
  } else {
    getDb().prepare('UPDATE players SET geschlecht = ? WHERE name = ?').run(geschlecht, name);
  }
}

// Spielernamen sind namensbasierte Fremdschlüssel (matches.side_a/b, teamPlayers
// splittet auf '/') und landen in Mails/Suche — Struktur-Tokens und Markup-Zeichen
// dürfen nie als Name existieren.
export function validatePlayerName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'empty' };
  if (name.length > 60) return { ok: false, error: 'toolong' };
  if (/^(BYE|TBD)$/i.test(name) || /^Sieger\s/i.test(name)) return { ok: false, error: 'reserved' };
  if (!/^[\p{L}\p{M}0-9 .'\-]+$/u.test(name)) return { ok: false, error: 'chars' };
  return { ok: true, name };
}

// Ersetzt einen exakten Spielernamen innerhalb eines Seiten-Strings ("A / B").
function replaceInSide(side: string | null, oldName: string, newName: string): string | null {
  if (!side || side === 'BYE' || side === 'TBD') return side;
  return side
    .split('/')
    .map((s) => s.trim())
    .map((n) => (n === oldName ? newName : n))
    .join(' / ');
}

// Benennt einen Spieler GLOBAL um — namensbasiert über alle Tabellen hinweg.
export function renamePlayer(oldName: string, newNameRaw: string): { ok: true } | { ok: false; error: string } {
  const valid = validatePlayerName(newNameRaw);
  if (!valid.ok) return valid;
  const newName = valid.name;
  if (newName === oldName) return { ok: true };
  const db = getDb();
  // Kein Zusammenführen: Zielname darf nicht bereits ein anderer Spieler sein.
  if (db.prepare('SELECT 1 FROM players WHERE name = ? AND name <> ?').get(newName, oldName)) {
    return { ok: false, error: 'taken' };
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE players SET name = ? WHERE name = ?').run(newName, oldName);
    db.prepare('UPDATE users SET player_name = ? WHERE player_name = ?').run(newName, oldName);
    db.prepare('UPDATE OR IGNORE competition_players SET player_name = ? WHERE player_name = ?').run(newName, oldName);
    db.prepare('DELETE FROM competition_players WHERE player_name = ?').run(oldName);
    const ms = db
      .prepare('SELECT id, side_a, side_b FROM matches WHERE side_a LIKE ? OR side_b LIKE ?')
      .all(`%${oldName}%`, `%${oldName}%`) as { id: number; side_a: string | null; side_b: string | null }[];
    const upd = db.prepare('UPDATE matches SET side_a = ?, side_b = ? WHERE id = ?');
    for (const m of ms) upd.run(replaceInSide(m.side_a, oldName, newName), replaceInSide(m.side_b, oldName, newName), m.id);
    db.prepare('UPDATE casual_matches SET player_a = ? WHERE player_a = ?').run(newName, oldName);
    db.prepare('UPDATE casual_matches SET player_b = ? WHERE player_b = ?').run(newName, oldName);
    db.prepare('UPDATE OR IGNORE ladder_players SET player_name = ? WHERE player_name = ?').run(newName, oldName);
    db.prepare('UPDATE challenges SET challenger = ? WHERE challenger = ?').run(newName, oldName);
    db.prepare('UPDATE challenges SET challenged = ? WHERE challenged = ?').run(newName, oldName);
    db.prepare('UPDATE OR IGNORE registrations SET player_name = ? WHERE player_name = ?').run(newName, oldName);
  });
  tx();
  return { ok: true };
}

// Ist der Name bereits als Spieler im Stamm vorhanden?
export function playerExists(name: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM players WHERE name = ?').get(name.trim());
}
