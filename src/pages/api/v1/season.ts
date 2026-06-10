import type { APIRoute } from 'astro';
import { getCompetitions, listSeasons, resolveSeason } from '../../../lib/tournament';
import { json, requireAdmin } from './_utils';

// GET /api/v1/season[?jahr=2026] — Saison (Standard: aktive) inkl. Konkurrenzen.
export const GET: APIRoute = ({ url, locals }) => {
  const guard = requireAdmin(locals.user);
  if (guard) return guard;

  const jahrParam = Number(url.searchParams.get('jahr'));
  const season = resolveSeason(Number.isFinite(jahrParam) && jahrParam > 0 ? jahrParam : null);
  if (!season) return json({ error: 'Keine Saison gefunden.' }, 404);

  return json({
    season,
    competitions: getCompetitions(season.id),
    seasons: listSeasons().map((s) => ({ id: s.id, jahr: s.jahr, name: s.name, status: s.status })),
  });
};
