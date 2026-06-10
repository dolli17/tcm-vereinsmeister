import type { APIRoute } from 'astro';
import { findFixtureById } from '../../lib/matchEntry';
import { getDb } from '../../lib/db';
import { buildIcs } from '../../lib/termine';

// ICS-Download für einen vereinbarten Termin (nur Beteiligte und Admin).
export const GET: APIRoute = async ({ url, locals }) => {
  const user = locals.user;
  if (!user) return new Response('forbidden', { status: 403 });

  const matchId = parseInt(url.searchParams.get('match_id') ?? '', 10);
  if (Number.isNaN(matchId)) return new Response('not found', { status: 404 });
  const fixture = findFixtureById(matchId);
  if (!fixture) return new Response('not found', { status: 404 });

  const isParticipant = !!user.player_name && [...fixture.sideA, ...fixture.sideB].includes(user.player_name);
  if (!isParticipant && user.role !== 'admin') return new Response('forbidden', { status: 403 });

  const row = getDb().prepare('SELECT termin FROM matches WHERE id = ?').get(matchId) as { termin: string | null } | undefined;
  if (!row?.termin) return new Response('kein Termin vereinbart', { status: 404 });

  const ics = buildIcs({
    termin: row.termin,
    title: `VM: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}`,
    description: `${fixture.wettbewerbLabel} — Vereinsmeisterschaft TC Muckensturm`,
    uid: `vm-match-${matchId}@tc-muckensturm`,
  });
  if (!ics) return new Response('Termin nicht im Kalenderformat', { status: 404 });

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="vm-spiel-${matchId}.ics"`,
    },
  });
};
