import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, getSessionUser } from './lib/auth';

// Setzt für jeden Request den eingeloggten User (oder null) in Astro.locals.
export const onRequest = defineMiddleware((context, next) => {
  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  context.locals.user = getSessionUser(sessionId);
  return next();
});
