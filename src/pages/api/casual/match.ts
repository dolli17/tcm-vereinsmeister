import type { APIRoute } from 'astro';
import { hasCasualAccess } from '../../../lib/auth';
import { addCasualMatch, deleteCasualMatch, validateCasualScore } from '../../../lib/casual';
import { validatePlayerName } from '../../../lib/players';

// Casual-Duelle erfassen/löschen. Zugriff ist bereits per Middleware abgesichert.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!hasCasualAccess(user) || !user) return new Response('not found', { status: 404 });

  const form = await request.formData();
  const action = String(form.get('action') ?? '');

  if (action === 'delete') {
    const id = parseInt(String(form.get('id') ?? ''), 10);
    const deleted = !Number.isNaN(id) && deleteCasualMatch(id, user);
    return redirect(deleted ? '/casual?ok=deleted' : '/casual?error=notowner');
  }

  if (action === 'add') {
    const validA = validatePlayerName(String(form.get('player_a') ?? ''));
    const validB = validatePlayerName(String(form.get('player_b') ?? ''));
    const datum = String(form.get('datum') ?? '').trim() || null;
    const notiz = String(form.get('notiz') ?? '').trim() || null;
    if (!validA.ok || !validB.ok) return redirect('/casual?error=names');
    const playerA = validA.name;
    const playerB = validB.name;
    if (playerA.toLowerCase() === playerB.toLowerCase()) return redirect('/casual?error=same');

    const valid = validateCasualScore({
      satz1: String(form.get('satz1') ?? ''),
      satz2: String(form.get('satz2') ?? ''),
      mtb: String(form.get('mtb') ?? ''),
    });
    if (!valid.ok) return redirect('/casual?error=score');

    addCasualMatch({ datum, playerA, playerB, score: valid.score, notiz, createdBy: user.id });
    return redirect('/casual?ok=added');
  }

  return redirect('/casual?error=input');
};
