import type { APIRoute } from 'astro';
import { updatePlayerPhone } from '../../../lib/players';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') {
    return redirect('/einstellungen?error=notapproved');
  }

  const form = await request.formData();
  const phone = String(form.get('telefon') ?? '').trim();
  // Einfache Plausibilität: leer (= entfernen) oder genug Ziffern.
  if (phone && phone.replace(/\D/g, '').length < 6) {
    return redirect('/einstellungen?error=phone');
  }

  updatePlayerPhone(user.player_name, phone);
  return redirect('/einstellungen?ok=phone');
};
