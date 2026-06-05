import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (locals.user?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const userId = parseInt(String(form.get('user_id') ?? ''), 10);
  const decision = String(form.get('decision') ?? '');
  if (Number.isNaN(userId) || !['approve', 'reject'].includes(decision)) {
    return redirect('/admin?error=1');
  }

  const status = decision === 'approve' ? 'approved' : 'rejected';
  getDb().prepare('UPDATE users SET claim_status = ? WHERE id = ?').run(status, userId);
  return redirect('/admin?ok=claim');
};
