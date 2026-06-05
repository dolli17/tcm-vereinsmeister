import type { APIRoute } from 'astro';
import { createSession, getUserByEmail, getPasswordHash, normalizeEmail, setPassword, setSessionCookie, upsertUser } from '../../../lib/auth';
import { getDb } from '../../../lib/db';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') ?? ''));
  const password = String(form.get('password') ?? '');
  const password2 = String(form.get('password2') ?? '');
  const playerName = String(form.get('player_name') ?? '').trim();

  if (!EMAIL_RE.test(email)) return redirect('/registrieren?error=email');
  if (password.length < 8) return redirect('/registrieren?error=pwlen');
  if (password !== password2) return redirect('/registrieren?error=pwmatch');
  if (!playerName) return redirect('/registrieren?error=name');

  const known = getDb().prepare('SELECT 1 FROM players WHERE name = ?').get(playerName);
  if (!known) return redirect('/registrieren?error=name');

  // Bereits registriert (mit Passwort)? Dann zum Login.
  const existing = getUserByEmail(email);
  if (existing && getPasswordHash(existing.id)) {
    return redirect('/login?error=exists');
  }

  const user = upsertUser(email, playerName);
  setPassword(user.id, password);

  const session = createSession(user.id);
  setSessionCookie(cookies, session.id);
  return redirect('/meine-spiele');
};
