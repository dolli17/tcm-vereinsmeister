import type { APIRoute } from 'astro';
import { createSession, getUserByEmail, getPasswordHash, normalizeEmail, setPassword, setSessionCookie, upsertUser } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { setGeschlecht, validatePlayerName } from '../../../lib/players';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') ?? ''));
  const password = String(form.get('password') ?? '');
  const password2 = String(form.get('password2') ?? '');
  const geschlecht = String(form.get('geschlecht') ?? '');

  if (!EMAIL_RE.test(email)) return redirect('/registrieren?error=email');
  if (password.length < 8) return redirect('/registrieren?error=pwlen');
  if (password !== password2) return redirect('/registrieren?error=pwmatch');
  if (geschlecht !== 'm' && geschlecht !== 'w') return redirect('/registrieren?error=geschlecht');

  // Offene Registrierung: bekannte Spieler ordnen sich zu, neue Namen werden im
  // Stamm angelegt — die Spielberechtigung gibt in beiden Fällen der Admin frei.
  const validName = validatePlayerName(String(form.get('player_name') ?? ''));
  if (!validName.ok) return redirect('/registrieren?error=name');
  const playerName = validName.name;

  const db = getDb();

  // Bereits registriert (mit Passwort)? Dann zum Login.
  const existing = getUserByEmail(email);
  if (existing && getPasswordHash(existing.id)) {
    return redirect('/login?error=exists');
  }

  // Name darf nicht schon von einem ANDEREN Account beansprucht sein (offen/bestätigt).
  const taken = db
    .prepare("SELECT 1 FROM users WHERE player_name = ? AND claim_status IN ('approved','pending') AND email != ?")
    .get(playerName, email);
  if (taken) return redirect('/registrieren?error=nametaken');

  // Neuen Namen im Stamm anlegen; bei bekannten Spielern nur ein noch
  // ungesetztes Geschlecht ergänzen (gepflegte Werte nicht überschreiben).
  db.prepare('INSERT OR IGNORE INTO players (name, geschlecht) VALUES (?, ?)').run(playerName, geschlecht);
  setGeschlecht(playerName, geschlecht as 'm' | 'w', { onlyIfNull: true });

  const user = upsertUser(email, playerName);
  setPassword(user.id, password);

  const session = createSession(user.id);
  setSessionCookie(cookies, session.id);
  return redirect('/meine-spiele');
};
