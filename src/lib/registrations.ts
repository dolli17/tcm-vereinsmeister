// Selbst-Anmeldung zur Saison: Spieler melden sich pro Konkurrenz an; der Admin
// übernimmt die Meldungen in competition_players (Gruppen-Einteilung bleibt Admin-Sache).
import { getDb } from './db';

export type Registration = {
  id: number;
  competition_id: number;
  player_name: string;
  user_id: number | null;
  notiz: string | null;
  created_at: string;
};

export function listRegistrations(competitionId: number): Registration[] {
  return getDb()
    .prepare('SELECT * FROM registrations WHERE competition_id = ? ORDER BY created_at')
    .all(competitionId) as Registration[];
}

export function isRegistered(competitionId: number, playerName: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM registrations WHERE competition_id = ? AND player_name = ?').get(competitionId, playerName);
}

export function register(competitionId: number, playerName: string, userId: number, notiz: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO registrations (competition_id, player_name, user_id, notiz) VALUES (?, ?, ?, ?)
       ON CONFLICT(competition_id, player_name) DO UPDATE SET notiz = excluded.notiz`,
    )
    .run(competitionId, playerName, userId, notiz);
}

export function withdraw(competitionId: number, playerName: string): void {
  getDb().prepare('DELETE FROM registrations WHERE competition_id = ? AND player_name = ?').run(competitionId, playerName);
}

// Übernimmt alle Meldungen einer Konkurrenz in competition_players (ohne Gruppe);
// bereits eingetragene Teilnehmer bleiben unangetastet. Liefert die Anzahl neuer.
export function adoptRegistrations(competitionId: number): number {
  const db = getDb();
  const regs = listRegistrations(competitionId);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO competition_players (competition_id, player_name, gruppe, gesetzt) VALUES (?, ?, NULL, 0)',
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const r of regs) added += ins.run(competitionId, r.player_name).changes;
  });
  tx();
  return added;
}

// Anzahl Meldungen je Konkurrenz einer Saison (für die Admin-Übersicht).
export function registrationCounts(seasonId: number): Map<number, number> {
  const rows = getDb()
    .prepare(
      `SELECT r.competition_id AS cid, COUNT(*) AS n
       FROM registrations r JOIN competitions c ON c.id = r.competition_id
       WHERE c.season_id = ? GROUP BY r.competition_id`,
    )
    .all(seasonId) as { cid: number; n: number }[];
  return new Map(rows.map((r) => [r.cid, r.n]));
}
