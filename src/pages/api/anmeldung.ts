import type { APIRoute } from 'astro';
import { getActiveSeason, getCompetition } from '../../lib/tournament';
import { isRegistered, register, withdraw } from '../../lib/registrations';

// Selbst-Anmeldung: an-/abmelden für eine Konkurrenz der aktiven Saison
// (nur solange das Meldefenster offen ist).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/anmeldung?error=notapproved');

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const compId = parseInt(String(form.get('competition_id') ?? ''), 10);
  if (Number.isNaN(compId) || !['signup', 'withdraw'].includes(action)) return redirect('/anmeldung?error=input');

  const season = getActiveSeason();
  const comp = getCompetition(compId);
  if (!season || !comp || comp.season_id !== season.id) return redirect('/anmeldung?error=input');
  if (!season.anmeldung_offen) return redirect('/anmeldung?error=closed');

  if (action === 'signup') {
    const notiz = String(form.get('notiz') ?? '').trim() || null;
    register(compId, user.player_name, user.id, notiz);
    return redirect('/anmeldung?ok=signup');
  }

  if (!isRegistered(compId, user.player_name)) return redirect('/anmeldung?error=input');
  withdraw(compId, user.player_name);
  return redirect('/anmeldung?ok=withdraw');
};
