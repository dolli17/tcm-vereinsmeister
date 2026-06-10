import type { APIRoute } from 'astro';
import { setGeschlecht } from '../../../lib/players';

// Spieler pflegt sein eigenes Geschlecht (für Forderungsliste/Konkurrenz-Zuordnung).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/einstellungen?error=notapproved');

  const form = await request.formData();
  const g = String(form.get('geschlecht') ?? '');
  if (g !== 'm' && g !== 'w') return redirect('/einstellungen?error=geschlecht');

  setGeschlecht(user.player_name, g);
  return redirect('/einstellungen?ok=geschlecht');
};
