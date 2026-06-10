import type { APIRoute } from 'astro';
import { remindMatch } from '../../../lib/reminders';
import { findFixtureById } from '../../../lib/matchEntry';
import { logAction } from '../../../lib/audit';

// Admin erinnert gezielt an EIN überfälliges Spiel (Button im Dashboard).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const matchId = parseInt(String(form.get('match_id') ?? ''), 10);
  if (Number.isNaN(matchId)) return redirect('/admin?error=1');

  const base = process.env.SITE_URL || new URL(request.url).origin;
  const res = await remindMatch(matchId, base);
  if (!res.ok) return redirect(`/admin?error=${res.error === 'keine_accounts' ? 'noaccounts' : '1'}`);

  const fixture = findFixtureById(matchId);
  logAction(admin, 'erinnerung_gesendet', fixture ? `${fixture.wettbewerbLabel}: ${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')} (${res.mails} Mails)` : `Match #${matchId}`);
  return redirect(`/admin?ok=reminded&n=${res.mails}`);
};
