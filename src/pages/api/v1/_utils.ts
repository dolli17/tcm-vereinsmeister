// Gemeinsame Helfer der Agenten-API (/api/v1): JSON-Antworten + Admin-Guard.
// Zugriff haben Bearer-Token (Service-Admin via Middleware) und eingeloggte Admins.
import type { User } from '../../../lib/auth';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function requireAdmin(user: User | null | undefined): Response | null {
  if (user?.role !== 'admin') return json({ error: 'unauthorized' }, 401);
  return null;
}
