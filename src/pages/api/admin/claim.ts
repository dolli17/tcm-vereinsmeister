import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { logAction } from '../../../lib/audit';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const userId = parseInt(String(form.get('user_id') ?? ''), 10);
  const decision = String(form.get('decision') ?? '');
  if (Number.isNaN(userId) || !['approve', 'reject'].includes(decision)) {
    return redirect('/admin?error=1');
  }

  const status = decision === 'approve' ? 'approved' : 'rejected';
  const db = getDb();
  const target = db.prepare('SELECT email, player_name FROM users WHERE id = ?').get(userId) as
    | { email: string; player_name: string | null }
    | undefined;
  db.prepare('UPDATE users SET claim_status = ? WHERE id = ?').run(status, userId);
  logAction(admin, decision === 'approve' ? 'name_freigegeben' : 'name_gesperrt', `${target?.email ?? userId} → ${target?.player_name ?? '–'}`);
  return redirect('/admin?ok=claim');
};
