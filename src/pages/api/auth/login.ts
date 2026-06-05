import type { APIRoute } from 'astro';
import { createSession, getPasswordHash, getUserByEmail, normalizeEmail, setSessionCookie, verifyPassword } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') ?? ''));
  const password = String(form.get('password') ?? '');

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, getPasswordHash(user.id))) {
    return redirect('/login?error=creds');
  }

  const session = createSession(user.id);
  setSessionCookie(cookies, session.id);
  return redirect('/meine-spiele');
};
