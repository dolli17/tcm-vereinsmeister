import type { APIRoute } from 'astro';
import {
  getCompetition,
  getCompetitionPlayers,
  getEnrichedMatches,
  getGruppen,
  getLastRoundWinners,
  getRunden,
} from '../../../../lib/tournament';
import { computeStandings, getGruppenQuali } from '../../../../lib/standings';
import { json, requireAdmin } from '../_utils';

// GET /api/v1/competition/<id> — eine Konkurrenz im Detail: Teilnehmer,
// Gruppen-Tabellen inkl. Quali-Status, K.o.-Runden und alle Paarungen.
export const GET: APIRoute = ({ params, locals }) => {
  const guard = requireAdmin(locals.user);
  if (guard) return guard;

  const id = parseInt(params.id ?? '', 10);
  const comp = Number.isNaN(id) ? null : getCompetition(id);
  if (!comp) return json({ error: 'Unbekannte Konkurrenz.' }, 404);

  const isGruppe = comp.modus === 'gruppe';
  return json({
    competition: comp,
    players: getCompetitionPlayers(comp.id),
    gruppen: isGruppe
      ? getGruppen(comp.id).map((g) => ({
          gruppe: g,
          standings: computeStandings(comp.id, g).map(({ telefon, ...row }) => row),
        }))
      : [],
    quali: isGruppe ? getGruppenQuali(comp.id) : [],
    runden: getRunden(comp.id),
    lastRoundWinners: getLastRoundWinners(comp.id),
    matches: getEnrichedMatches(comp.id),
  });
};
