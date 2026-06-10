import type { APIRoute } from 'astro';
import { runLadderReminders } from '../../../lib/reminders';

// Per Cron (täglich): prüft die 14-Tage-Fristen der Forderungsliste.
// VM-Spiele werden nicht mehr automatisch angemahnt — das macht der Admin
// gezielt pro überfälligem Spiel im Dashboard.
// Geschützt per ?key=CRON_SECRET; ?dry=1 sendet nicht.
const handler: APIRoute = async ({ request, url }) => {
  const key = url.searchParams.get('key');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const dry = url.searchParams.get('dry') === '1';
  const base = process.env.SITE_URL || new URL(request.url).origin;

  const ladder = await runLadderReminders({ baseUrl: base, dry });
  return Response.json({ ladder });
};

export const GET = handler;
export const POST = handler;
