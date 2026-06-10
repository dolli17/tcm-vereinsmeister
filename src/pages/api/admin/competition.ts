import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { logAction } from '../../../lib/audit';
import { adoptRegistrations } from '../../../lib/registrations';

// Konkurrenzen + Teilnehmer einer Saison verwalten (nur Admin).
const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'konkurrenz';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const db = getDb();
  const back = (suffix: string) => redirect(`/admin/saison${suffix}`);

  if (action === 'comp_create') {
    const seasonId = parseInt(String(form.get('season_id') ?? ''), 10);
    const name = String(form.get('name') ?? '').trim();
    const art = String(form.get('art') ?? 'einzel');
    const modus = String(form.get('modus') ?? 'gruppe');
    if (Number.isNaN(seasonId) || !name || !['einzel', 'doppel'].includes(art) || !['gruppe', 'ko'].includes(modus)) {
      return back(`?error=input`);
    }
    // Tabellen rechnen je Einzelspieler — Doppel im Gruppen-Modus stünde ewig auf 0.
    if (art === 'doppel' && modus === 'gruppe') return back('?error=doppelgruppe');
    let slug = slugify(name);
    // Slug innerhalb der Saison eindeutig machen.
    const exists = db.prepare('SELECT 1 FROM competitions WHERE season_id = ? AND slug = ?');
    let i = 2;
    while (exists.get(seasonId, slug)) slug = `${slugify(name)}-${i++}`;
    const sort = (db.prepare('SELECT COALESCE(MAX(sort),-1)+1 AS n FROM competitions WHERE season_id = ?').get(seasonId) as { n: number }).n;
    db.prepare('INSERT INTO competitions (season_id, slug, name, art, modus, sort) VALUES (?, ?, ?, ?, ?, ?)').run(seasonId, slug, name, art, modus, sort);
    logAction(admin, 'konkurrenz_angelegt', `${name} (${art}/${modus})`);
    return back(`?season=${seasonId}&ok=comp`);
  }

  const compId = parseInt(String(form.get('competition_id') ?? ''), 10);
  if (Number.isNaN(compId)) return back('?error=input');
  const comp = db.prepare('SELECT season_id, art FROM competitions WHERE id = ?').get(compId) as
    | { season_id: number; art: string }
    | undefined;
  const seasonQs = comp ? `?season=${comp.season_id}` : '';

  if (action === 'comp_update') {
    const name = String(form.get('name') ?? '').trim();
    const modus = String(form.get('modus') ?? '');
    if (comp?.art === 'doppel' && modus === 'gruppe') return back(`${seasonQs}&error=doppelgruppe`);
    if (name) db.prepare('UPDATE competitions SET name = ? WHERE id = ?').run(name, compId);
    if (['gruppe', 'ko'].includes(modus)) db.prepare('UPDATE competitions SET modus = ? WHERE id = ?').run(modus, compId);
    return back(`${seasonQs}&ok=comp`);
  }

  if (action === 'comp_move' && comp) {
    const dir = String(form.get('dir') ?? '');
    const cur = db.prepare('SELECT id, sort FROM competitions WHERE id = ?').get(compId) as { id: number; sort: number };
    const neighbor = dir === 'up'
      ? db.prepare('SELECT id, sort FROM competitions WHERE season_id = ? AND sort < ? ORDER BY sort DESC LIMIT 1').get(comp.season_id, cur.sort)
      : db.prepare('SELECT id, sort FROM competitions WHERE season_id = ? AND sort > ? ORDER BY sort ASC LIMIT 1').get(comp.season_id, cur.sort);
    if (neighbor) {
      const nb = neighbor as { id: number; sort: number };
      const tx = db.transaction(() => {
        db.prepare('UPDATE competitions SET sort = ? WHERE id = ?').run(nb.sort, cur.id);
        db.prepare('UPDATE competitions SET sort = ? WHERE id = ?').run(cur.sort, nb.id);
      });
      tx();
    }
    return back(`${seasonQs}&ok=comp`);
  }

  if (action === 'comp_delete') {
    const name = (db.prepare('SELECT name FROM competitions WHERE id = ?').get(compId) as { name: string } | undefined)?.name;
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM results WHERE match_id IN (SELECT id FROM matches WHERE competition_id = ?)').run(compId);
      db.prepare('DELETE FROM competitions WHERE id = ?').run(compId); // matches & players via ON DELETE CASCADE
    });
    tx();
    logAction(admin, 'konkurrenz_geloescht', name ?? `#${compId}`);
    return back(`${seasonQs}&ok=compdel`);
  }

  if (action === 'player_add') {
    const name = String(form.get('player_name') ?? '').trim();
    const gruppeRaw = String(form.get('gruppe') ?? '').trim();
    const gruppe = gruppeRaw ? parseInt(gruppeRaw, 10) : null;
    const gesetzt = form.get('gesetzt') === 'on' ? 1 : 0;
    if (!name) return redirect(`/admin/konkurrenz/${compId}?error=input`);
    // In den globalen Stamm aufnehmen, falls neu.
    db.prepare('INSERT OR IGNORE INTO players (name) VALUES (?)').run(name);
    db.prepare(
      `INSERT INTO competition_players (competition_id, player_name, gruppe, gesetzt) VALUES (?, ?, ?, ?)
       ON CONFLICT(competition_id, player_name) DO UPDATE SET gruppe = excluded.gruppe, gesetzt = excluded.gesetzt`,
    ).run(compId, name, gruppe, gesetzt);
    return redirect(`/admin/konkurrenz/${compId}?ok=player`);
  }

  // Meldungen der Selbst-Anmeldung als Teilnehmer übernehmen (ohne Gruppe).
  if (action === 'meldungen_uebernehmen') {
    const added = adoptRegistrations(compId);
    logAction(locals.user, 'meldungen_uebernommen', `Konkurrenz #${compId}: ${added} neu`);
    return redirect(`/admin/konkurrenz/${compId}?ok=adopted&n=${added}`);
  }

  if (action === 'player_remove') {
    const name = String(form.get('player_name') ?? '');
    db.prepare('DELETE FROM competition_players WHERE competition_id = ? AND player_name = ?').run(compId, name);
    return redirect(`/admin/konkurrenz/${compId}?ok=playerdel`);
  }

  return back('?error=input');
};
