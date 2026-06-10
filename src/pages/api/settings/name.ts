import type { APIRoute } from 'astro';
import { renamePlayer } from '../../../lib/players';
import { logAction } from '../../../lib/audit';

// Spieler benennt seinen eigenen (freigegebenen) Namen um — global kaskadierend.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/einstellungen?error=notapproved');

  const form = await request.formData();
  const neu = String(form.get('player_name') ?? '').trim();
  if (!neu) return redirect('/einstellungen?error=nameempty');
  if (neu === user.player_name) return redirect('/einstellungen?ok=name');

  const res = renamePlayer(user.player_name, neu);
  if (!res.ok) {
    const code = res.error === 'taken' ? 'nametaken' : res.error === 'empty' ? 'nameempty' : 'nameinvalid';
    return redirect(`/einstellungen?error=${code}`);
  }
  logAction(user, 'spieler_umbenannt', `${user.player_name} → ${neu}`);
  return redirect('/einstellungen?ok=name');
};
