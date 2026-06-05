// Authentifizierung: E-Mail + Passwort, Cookie-Session.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getDb } from './db';

const RESET_TTL_MIN = 60; // Passwort-Reset-Link gültig 60 Minuten

export const SESSION_COOKIE = 'vm_session';
const SESSION_TTL_DAYS = 30;

export type User = {
  id: number;
  email: string;
  player_name: string | null;
  role: 'player' | 'admin';
  claim_status: 'pending' | 'approved' | 'rejected';
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Passwort-Hashing (scrypt, ohne externe Abhängigkeit) ────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const hash = Buffer.from(hashHex, 'hex');
  const test = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

// ── User-Zugriff ────────────────────────────────────────────────────────────
export function getUserByEmail(email: string): User | undefined {
  return getDb()
    .prepare('SELECT id, email, player_name, role, claim_status FROM users WHERE email = ?')
    .get(normalizeEmail(email)) as User | undefined;
}

export function getPasswordHash(userId: number): string | null {
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string | null } | undefined;
  return row?.password_hash ?? null;
}

export function setPassword(userId: number, password: string): void {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

// ── Passwort-Reset ──────────────────────────────────────────────────────────
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createResetToken(userId: number): string {
  const raw = randomBytes(32).toString('base64url');
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + RESET_TTL_MIN);
  getDb().prepare('INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, sha256(raw), expires.toISOString());
  return raw;
}

// Verbraucht ein Reset-Token (einmalig) und liefert die user_id.
export function consumeResetToken(raw: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT id, user_id, expires_at, used_at FROM reset_tokens WHERE token_hash = ?').get(sha256(raw)) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
  db.prepare("UPDATE reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row.user_id;
}

// Alle Sessions eines Users beenden (z. B. nach Passwort-Reset).
export function destroyUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// Legt den User an oder aktualisiert den Namensanspruch. Gibt den User zurück.
export function upsertUser(email: string, playerName?: string | null): User {
  const db = getDb();
  const norm = normalizeEmail(email);
  let user = getUserByEmail(norm);
  if (!user) {
    db.prepare('INSERT INTO users (email, player_name, claim_status) VALUES (?, ?, ?)').run(norm, playerName ?? null, 'pending');
    user = getUserByEmail(norm)!;
  } else if (playerName && playerName !== user.player_name) {
    const status = user.claim_status === 'approved' ? 'approved' : 'pending';
    db.prepare('UPDATE users SET player_name = ?, claim_status = ? WHERE id = ?').run(playerName, status, user.id);
    user = getUserByEmail(norm)!;
  }
  return user;
}

// ── Sessions ────────────────────────────────────────────────────────────────
export function createSession(userId: number): { id: string; expiresAt: Date } {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);
  getDb().prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt.toISOString());
  return { id, expiresAt };
}

export function getSessionUser(sessionId: string | undefined): User | null {
  if (!sessionId) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.player_name, u.role, u.claim_status, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(sessionId) as (User & { expires_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(sessionId);
    return null;
  }
  const { expires_at, ...user } = row;
  return user;
}

export function destroySession(sessionId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export const SESSION_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;
export const cookieSecure = (process.env.COOKIE_SECURE ?? 'false') === 'true';

export function setSessionCookie(cookies: import('astro').AstroCookies, sessionId: string): void {
  cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}
