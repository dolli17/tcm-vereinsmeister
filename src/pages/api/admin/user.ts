import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const userId = parseInt(String(form.get('user_id') ?? ''), 10);
  const action = String(form.get('action') ?? '');
  if (Number.isNaN(userId) || action !== 'delete') return redirect('/admin?error=1');

  // Sich selbst nicht löschen (Aussperr-Schutz).
  if (userId === admin.id) return redirect('/admin?error=self');

  const db = getDb();
  // Ergebnis-Referenzen lösen, Sessions werden per ON DELETE CASCADE entfernt.
  const tx = db.transaction(() => {
    db.prepare('UPDATE results SET submitted_by = NULL WHERE submitted_by = ?').run(userId);
    db.prepare('UPDATE results SET decided_by = NULL WHERE decided_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  return redirect('/admin?ok=userdeleted');
};
