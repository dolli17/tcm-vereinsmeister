import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import {
  fmtDatum,
  formatChallengeResult,
  getChallenge,
  insertAtRank,
  isListe,
  leaveLadder,
  moveEntry,
  penalty,
  resolveExpired,
  type ExpiredOutcome,
} from '../../../lib/ladder';
import { logAction } from '../../../lib/audit';
import { emailsForNames } from '../../../lib/notify';
import { sendMail, mailLayout } from '../../../lib/mail';

// Forderungsliste — Admin: einsortieren, entfernen, sortieren, Sanktion (Regel 7),
// überfällige Forderungen werten (Regel 12). Alles im Audit-Log.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const back = '/admin/forderung';

  // Überfällige Forderung werten.
  if (action === 'resolve') {
    const id = parseInt(String(form.get('challenge_id') ?? ''), 10);
    const outcome = String(form.get('outcome') ?? '') as ExpiredOutcome;
    if (Number.isNaN(id) || !['kampflos_challenger', 'kampflos_challenged', 'verfallen'].includes(outcome)) {
      return redirect(`${back}?error=input`);
    }
    const res = resolveExpired(id, admin.id, outcome);
    if (!res.ok) return redirect(`${back}?error=${res.error}`);
    const c = res.value!;
    logAction(admin, 'forderung_gewertet', `${c.challenger} vs ${c.challenged} → ${outcome}`);

    const emails = emailsForNames([c.challenger, c.challenged]);
    if (emails.length > 0) {
      const text =
        outcome === 'verfallen'
          ? 'Die Forderung ist verfallen — die Rangliste bleibt unverändert.'
          : outcome === 'kampflos_challenger'
            ? `Die Forderung wurde kampflos für ${c.challenger} gewertet — er/sie übernimmt den Platz von ${c.challenged}.`
            : `Die Forderung wurde kampflos für ${c.challenged} gewertet — die Rangliste bleibt unverändert, ${c.challenger} hat 7 Tage Forderungssperre.`;
      await sendMail({
        to: emails,
        subject: `Forderung gewertet: ${c.challenger} vs ${c.challenged}`,
        html: mailLayout('Forderung gewertet', `<p>Die Frist (${fmtDatum(c.deadline)}) war abgelaufen.</p><p>${text}</p>`),
      });
    }
    return redirect(`${back}?ok=resolved`);
  }

  const liste = String(form.get('liste') ?? '');
  const name = String(form.get('player_name') ?? '').trim();
  if (!isListe(liste) || !name) return redirect(`${back}?error=input`);

  if (action === 'add') {
    if (!getDb().prepare('SELECT 1 FROM players WHERE name = ?').get(name)) return redirect(`${back}?error=unbekannt`);
    const rankRaw = parseInt(String(form.get('rank') ?? ''), 10);
    const rank = Number.isFinite(rankRaw) && rankRaw > 0 ? rankRaw : Number.MAX_SAFE_INTEGER;
    const res = insertAtRank(liste, name, rank);
    if (!res.ok) return redirect(`${back}?error=${res.error}`);
    logAction(admin, 'forderung_spieler_einsortiert', `${name} → ${liste} Rang ${rank === Number.MAX_SAFE_INTEGER ? 'Ende' : rank}`);
    return redirect(`${back}?ok=added`);
  }

  if (action === 'remove') {
    const res = leaveLadder(liste, name);
    if (!res.ok) return redirect(`${back}?error=${res.error}`);
    logAction(admin, 'forderung_spieler_entfernt', `${name} (${liste})`);
    return redirect(`${back}?ok=removed`);
  }

  if (action === 'move') {
    const dir = String(form.get('dir') ?? '');
    if (dir !== 'up' && dir !== 'down') return redirect(`${back}?error=input`);
    const res = moveEntry(liste, name, dir);
    return redirect(res.ok ? `${back}?ok=moved` : `${back}?error=${res.error}`);
  }

  // Sanktion (Regel 7): 10 Plätze zurück.
  if (action === 'penalty') {
    const res = penalty(liste, name, 10);
    if (!res.ok) return redirect(`${back}?error=${res.error}`);
    logAction(admin, 'forderung_sanktion', `${name} (${liste}): 10 Plätze zurück`);
    return redirect(`${back}?ok=penalty`);
  }

  return redirect(`${back}?error=input`);
};
