// Bearer-Token-Auth für Agenten (OpenClaw, Claude, …): API_TOKENS in der .env
// als kommagetrennte name:token-Paare. Ein gültiger Token agiert als
// Service-Admin-User — damit funktionieren alle Admin-Endpunkte und das
// Audit-Log zeigt, welcher Agent gehandelt hat.
import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';
import type { User } from './auth';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// name:token-Paare aus der Umgebung; ungültige Einträge werden ignoriert.
function parseTokens(): { name: string; token: string }[] {
  return (process.env.API_TOKENS ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      return i > 0 ? { name: pair.slice(0, i).trim(), token: pair.slice(i + 1).trim() } : null;
    })
    .filter((p): p is { name: string; token: string } => !!p && !!p.name && !!p.token);
}

// Service-User-Zeile sicherstellen: role=admin, ohne password_hash (kein
// Passwort-Login möglich). Wird sie im Admin gelöscht, entsteht sie beim
// nächsten API-Call einfach neu.
function ensureServiceUser(name: string): User | null {
  const db = getDb();
  const email = `api+${name.toLowerCase()}@service.local`;
  db.prepare(
    `INSERT INTO users (email, role, claim_status) VALUES (?, 'admin', 'approved')
     ON CONFLICT(email) DO UPDATE SET role = 'admin', claim_status = 'approved'`,
  ).run(email);
  return (
    (db
      .prepare('SELECT id, email, player_name, role, claim_status, casual_access FROM users WHERE email = ?')
      .get(email) as User | undefined) ?? null
  );
}

// Mappt einen "Authorization: Bearer …"-Header auf den Service-Admin-User.
// Kein/ungültiger Token → null (Vergleich timing-safe über sha256-Digests).
export function getApiUser(authHeader: string | null): User | null {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const presented = Buffer.from(sha256(m[1].trim()), 'hex');
  for (const { name, token } of parseTokens()) {
    const expected = Buffer.from(sha256(token), 'hex');
    if (timingSafeEqual(presented, expected)) return ensureServiceUser(name);
  }
  return null;
}
