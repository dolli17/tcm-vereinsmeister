import type { APIRoute } from 'astro';
import { resolveSeason } from '../../../lib/tournament';
import { getAllFixturesWithStatus } from '../../../lib/matchEntry';
import { json, requireAdmin } from './_utils';

// GET /api/v1/matches[?jahr=…&competition=<slug>&status=open|pending|confirmed|rejected]
// Alle Paarungen der Saison (ohne Freilose/Platzhalter) mit Ergebnis und Status.
export const GET: APIRoute = ({ url, locals }) => {
  const guard = requireAdmin(locals.user);
  if (guard) return guard;

  const jahrParam = Number(url.searchParams.get('jahr'));
  const season = resolveSeason(Number.isFinite(jahrParam) && jahrParam > 0 ? jahrParam : null);
  if (!season) return json({ error: 'Keine Saison gefunden.' }, 404);

  const competition = url.searchParams.get('competition');
  const status = url.searchParams.get('status');
  let fixtures = getAllFixturesWithStatus(season.id);
  if (competition) fixtures = fixtures.filter((f) => f.wettbewerb === competition);
  if (status) fixtures = fixtures.filter((f) => f.status === status);

  return json({ season: { id: season.id, jahr: season.jahr, name: season.name }, count: fixtures.length, matches: fixtures });
};
