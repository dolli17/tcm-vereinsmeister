import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, getSessionUser, hasCasualAccess } from './lib/auth';
import { getApiUser } from './lib/apiAuth';

// Setzt für jeden Request den eingeloggten User (oder null) in Astro.locals und
// schützt den versteckten Casual-Bereich (kein Nav-Link, nur per Flag/Admin).
export const onRequest = defineMiddleware((context, next) => {
  // Agenten-Zugriff per Bearer-Token: ein Request mit Authorization-Header wird
  // ausschließlich darüber autorisiert (kein Cookie-Fallback bei ungültigem Token).
  const authHeader = context.request.headers.get('authorization');
  if (authHeader) {
    context.locals.user = getApiUser(authHeader);
  } else {
    const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
    context.locals.user = getSessionUser(sessionId);
  }

  const path = context.url.pathname;
  if (path === '/casual' || path.startsWith('/casual/') || path.startsWith('/api/casual')) {
    if (!hasCasualAccess(context.locals.user)) {
      // Nichts verraten: Seiten -> Startseite, API -> 404.
      if (path.startsWith('/api/')) return new Response('not found', { status: 404 });
      return context.redirect('/');
    }
  }

  return next();
});
