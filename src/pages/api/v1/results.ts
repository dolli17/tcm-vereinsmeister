import type { APIRoute } from 'astro';
import { adminDeleteResult, adminSetResult } from '../../../lib/matchEntry';
import { json, requireAdmin } from './_utils';

type Body = {
  match_id?: number;
  typ?: string;
  satz1?: string;
  satz2?: string;
  mtb?: string;
  sieger?: string;
};

async function parseBody(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}

// POST /api/v1/results — Ergebnis maßgeblich eintragen (sofort bestätigt,
// ersetzt Bestehendes; Sätze aus Sicht von Seite A):
// { "match_id": 12, "satz1": "6:3", "satz2": "4:6", "mtb": "10:7" }
// Sonderfälle: { "match_id": 12, "typ": "wo" | "aufgabe", "sieger": "A" | "B", … }
export const POST: APIRoute = async ({ request, locals }) => {
  const guard = requireAdmin(locals.user);
  if (guard) return guard;

  const body = await parseBody(request);
  const matchId = Number(body?.match_id);
  if (!body || !Number.isInteger(matchId)) return json({ error: 'JSON-Body mit numerischer match_id erwartet.' }, 400);

  const res = adminSetResult(
    matchId,
    {
      typ: body.typ ?? 'gespielt',
      satz1: body.satz1 ?? '',
      satz2: body.satz2 ?? '',
      mtb: body.mtb ?? '',
      sieger: body.sieger ?? '',
    },
    locals.user!,
  );
  if (!res.ok) return json({ error: res.error }, res.error === 'Unbekanntes Match.' ? 404 : 422);

  return json({
    ok: true,
    match: {
      id: res.fixture.matchId,
      wettbewerb: res.fixture.wettbewerb,
      sideA: res.fixture.sideA,
      sideB: res.fixture.sideB,
    },
    result: { ...res.score, status: 'confirmed' },
  });
};

// DELETE /api/v1/results — Ergebnis eines Matches löschen: { "match_id": 12 }
export const DELETE: APIRoute = async ({ request, locals }) => {
  const guard = requireAdmin(locals.user);
  if (guard) return guard;

  const body = await parseBody(request);
  const matchId = Number(body?.match_id);
  if (!body || !Number.isInteger(matchId)) return json({ error: 'JSON-Body mit numerischer match_id erwartet.' }, 400);

  const res = adminDeleteResult(matchId, locals.user!);
  if (!res.ok) return json({ error: res.error }, 404);
  return json({ ok: true, match_id: matchId });
};
