import type { APIRoute } from 'astro';
import { SESSION_COOKIE, destroySession } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) destroySession(sessionId);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/');
};
