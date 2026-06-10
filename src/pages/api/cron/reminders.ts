import type { APIRoute } from 'astro';
import { runReminders } from '../../../lib/reminders';

// Per Cron (täglich); erinnert gegen Monatsende an offene/überfällige Spiele.
// Geschützt per ?key=CRON_SECRET. ?force=1 ignoriert das Monatsende-Fenster, ?dry=1 sendet nicht.
const handler: APIRoute = async ({ request, url }) => {
  const key = url.searchParams.get('key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const force = url.searchParams.get('force') === '1';
  const dry = url.searchParams.get('dry') === '1';

  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!force && lastDay - now.getDate() > 6) {
    return Response.json({ skipped: 'nicht nah am Monatsende', tag: now.getDate(), monatsende: lastDay });
  }

  const base = process.env.SITE_URL || new URL(request.url).origin;
  const result = await runReminders({ baseUrl: base, dry });
  return Response.json(result);
};

export const GET = handler;
export const POST = handler;
