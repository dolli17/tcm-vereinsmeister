import type { APIRoute } from 'astro';
import { consumeResetToken, destroyUserSessions, setPassword } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const password2 = String(form.get('password2') ?? '');

  const back = `/passwort-zuruecksetzen?token=${encodeURIComponent(token)}`;
  if (password.length < 8) return redirect(`${back}&error=pwlen`);
  if (password !== password2) return redirect(`${back}&error=pwmatch`);

  const userId = consumeResetToken(token);
  if (!userId) return redirect('/passwort-zuruecksetzen?error=token');

  setPassword(userId, password);
  destroyUserSessions(userId); // alle bestehenden Logins beenden
  return redirect('/login?reset=1');
};
