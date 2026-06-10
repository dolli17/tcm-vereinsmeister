import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { playerExists, renamePlayer, setGeschlecht, updatePlayerPhone, validatePlayerName } from '../../../lib/players';

// Globaler Spielerstamm: anlegen, Telefonnummer pflegen, Spieler umbenennen (nur Admin).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (locals.user?.role !== 'admin') return redirect('/login');
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const name = String(form.get('name') ?? '').trim();

  // Neuen Spieler im Stamm anlegen (optional mit Telefonnummer).
  if (action === 'create') {
    const valid = validatePlayerName(name);
    if (!valid.ok) return redirect('/admin/spieler?error=input');
    if (playerExists(valid.name)) return redirect('/admin/spieler?error=exists');
    const geschlecht = String(form.get('geschlecht') ?? '');
    getDb()
      .prepare('INSERT OR IGNORE INTO players (name, geschlecht) VALUES (?, ?)')
      .run(valid.name, geschlecht === 'm' || geschlecht === 'w' ? geschlecht : null);
    const tel = String(form.get('telefon') ?? '').trim();
    if (tel) updatePlayerPhone(valid.name, tel);
    return redirect('/admin/spieler?ok=created');
  }

  if (!name) return redirect('/admin/spieler?error=input');

  if (action === 'phone') {
    updatePlayerPhone(name, String(form.get('telefon') ?? ''));
    return redirect('/admin/spieler?ok=phone');
  }

  if (action === 'geschlecht') {
    const g = String(form.get('geschlecht') ?? '');
    if (g !== 'm' && g !== 'w') return redirect('/admin/spieler?error=input');
    setGeschlecht(name, g);
    return redirect('/admin/spieler?ok=geschlecht');
  }

  if (action === 'rename') {
    const neu = String(form.get('new_name') ?? '').trim();
    const res = renamePlayer(name, neu);
    if (!res.ok) return redirect(`/admin/spieler?error=${res.error === 'taken' ? 'taken' : 'input'}`);
    return redirect('/admin/spieler?ok=rename');
  }

  return redirect('/admin/spieler?error=input');
};
