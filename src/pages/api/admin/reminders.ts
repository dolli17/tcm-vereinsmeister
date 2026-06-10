import type { APIRoute } from 'astro';
import { runReminders } from '../../../lib/reminders';

// Admin löst die Erinnerungs-Mails manuell aus (ohne Monatsende-Fenster).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (locals.user?.role !== 'admin') return redirect('/login');
  const base = process.env.SITE_URL || new URL(request.url).origin;
  const res = await runReminders({ baseUrl: base, dry: false });
  return redirect(`/admin?ok=reminded&n=${res.mailsSent}`);
};
