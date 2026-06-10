import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { logAction } from '../../../lib/audit';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const userId = parseInt(String(form.get('user_id') ?? ''), 10);
  const action = String(form.get('action') ?? '');
  if (Number.isNaN(userId) || !['delete', 'casual', 'role'].includes(action)) return redirect('/admin?error=1');

  const db = getDb();
  const target = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
  if (!target) return redirect('/admin?error=1');

  // Casual-Zugriff für einen Account umschalten.
  if (action === 'casual') {
    db.prepare('UPDATE users SET casual_access = 1 - casual_access WHERE id = ?').run(userId);
    logAction(admin, 'casual_umgeschaltet', target.email);
    return redirect('/admin?ok=casual');
  }

  // Admin-Rolle umschalten (sich selbst nicht degradieren — Aussperr-Schutz).
  if (action === 'role') {
    if (userId === admin.id) return redirect('/admin?error=self');
    db.prepare("UPDATE users SET role = CASE WHEN role = 'admin' THEN 'player' ELSE 'admin' END WHERE id = ?").run(userId);
    logAction(admin, 'rolle_umgeschaltet', target.email);
    return redirect('/admin?ok=role');
  }

  // Sich selbst nicht löschen (Aussperr-Schutz).
  if (userId === admin.id) return redirect('/admin?error=self');
  // Ergebnis-/Casual-Referenzen lösen, Sessions werden per ON DELETE CASCADE entfernt.
  const tx = db.transaction(() => {
    db.prepare('UPDATE results SET submitted_by = NULL WHERE submitted_by = ?').run(userId);
    db.prepare('UPDATE results SET decided_by = NULL WHERE decided_by = ?').run(userId);
    db.prepare('UPDATE casual_matches SET created_by = NULL WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
  logAction(admin, 'account_geloescht', target.email);

  return redirect('/admin?ok=userdeleted');
};
