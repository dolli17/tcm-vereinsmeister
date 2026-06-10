import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { logAction } from '../../../lib/audit';

// Saisonverwaltung (nur Admin): anlegen, aktiv schalten, archivieren.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const db = getDb();

  if (action === 'create') {
    const jahr = parseInt(String(form.get('jahr') ?? ''), 10);
    const name = String(form.get('name') ?? '').trim() || (Number.isFinite(jahr) ? `Vereinsmeisterschaft ${jahr}` : '');
    if (!Number.isFinite(jahr) || !name) return redirect('/admin/saison?error=input');
    const setActive = form.get('aktiv') === 'on';
    const tx = db.transaction(() => {
      const id = db.prepare("INSERT INTO seasons (jahr, name, status) VALUES (?, ?, 'archiviert')").run(jahr, name).lastInsertRowid as number;
      if (setActive) {
        db.prepare("UPDATE seasons SET status = 'archiviert'").run();
        db.prepare("UPDATE seasons SET status = 'aktiv' WHERE id = ?").run(id);
      }
    });
    tx();
    logAction(admin, 'saison_angelegt', name);
    return redirect('/admin/saison?ok=created');
  }

  const id = parseInt(String(form.get('season_id') ?? ''), 10);
  if (Number.isNaN(id)) return redirect('/admin/saison?error=input');

  if (action === 'activate') {
    const tx = db.transaction(() => {
      db.prepare("UPDATE seasons SET status = 'archiviert'").run();
      db.prepare("UPDATE seasons SET status = 'aktiv' WHERE id = ?").run(id);
    });
    tx();
    logAction(admin, 'saison_aktiviert', `Saison #${id}`);
    return redirect('/admin/saison?ok=activated');
  }

  if (action === 'archive') {
    db.prepare("UPDATE seasons SET status = 'archiviert', anmeldung_offen = 0 WHERE id = ?").run(id);
    logAction(admin, 'saison_archiviert', `Saison #${id}`);
    return redirect('/admin/saison?ok=archived');
  }

  // Meldefenster für die Selbst-Anmeldung umschalten.
  if (action === 'meldung') {
    db.prepare('UPDATE seasons SET anmeldung_offen = 1 - anmeldung_offen WHERE id = ?').run(id);
    logAction(admin, 'meldefenster_umgeschaltet', `Saison #${id}`);
    return redirect(`/admin/saison?season=${id}&ok=meldung`);
  }

  return redirect('/admin/saison?error=input');
};
