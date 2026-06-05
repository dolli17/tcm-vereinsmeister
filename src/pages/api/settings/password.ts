import type { APIRoute } from 'astro';
import { getPasswordHash, setPassword, verifyPassword } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');

  const form = await request.formData();
  const current = String(form.get('current') ?? '');
  const next = String(form.get('password') ?? '');
  const next2 = String(form.get('password2') ?? '');

  if (!verifyPassword(current, getPasswordHash(user.id))) {
    return redirect('/einstellungen?error=current');
  }
  if (next.length < 8) return redirect('/einstellungen?error=pwlen');
  if (next !== next2) return redirect('/einstellungen?error=pwmatch');

  setPassword(user.id, next);
  return redirect('/einstellungen?ok=pw');
};
