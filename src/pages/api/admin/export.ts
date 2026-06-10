import type { APIRoute } from 'astro';
import { getActiveSeason, getCompetitions, getEnrichedMatches, getSeason, isPlayed } from '../../../lib/tournament';

// CSV-Export aller Paarungen/Ergebnisse einer Saison (nur Admin).
// Semikolon-getrennt + BOM, damit deutsches Excel die Datei direkt öffnet.
export const GET: APIRoute = async ({ url, locals }) => {
  if (locals.user?.role !== 'admin') return new Response('forbidden', { status: 403 });

  const seasonParam = parseInt(url.searchParams.get('season') ?? '', 10);
  const season = Number.isNaN(seasonParam) ? getActiveSeason() : getSeason(seasonParam);
  if (!season) return new Response('keine Saison gefunden', { status: 404 });

  const esc = (v: string | number | null) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows: string[] = [
    ['Saison', 'Konkurrenz', 'Kontext', 'Nr', 'Seite A', 'Seite B', 'Satz 1', 'Satz 2', 'MTB', 'Sieger', 'Status'].join(';'),
  ];
  for (const comp of getCompetitions(season.id)) {
    for (const m of getEnrichedMatches(comp.id)) {
      const ctx = m.gruppe != null ? `Gruppe ${m.gruppe}` : m.runde ?? '';
      const winner = m.sieger === 'A' ? m.sideA : m.sieger === 'B' ? m.sideB : '';
      rows.push(
        [season.name, comp.name, ctx, m.nr, m.sideA ?? '', m.sideB ?? '', m.satz1 ?? '', m.satz2 ?? '', m.mtb ?? '', winner ?? '', isPlayed(m) ? 'gespielt' : 'offen']
          .map(esc)
          .join(';'),
      );
    }
  }

  return new Response('\ufeff' + rows.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vm-${season.jahr}-ergebnisse.csv"`,
    },
  });
};
