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
