import type { APIRoute } from 'astro';
import { adminDeleteResult, adminSetResult } from '../../../lib/matchEntry';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const admin = locals.user;
  if (admin?.role !== 'admin') return redirect('/login');

  const form = await request.formData();
  const matchId = parseInt(String(form.get('match_id') ?? ''), 10);
  const action = String(form.get('action') ?? 'save');
  if (Number.isNaN(matchId)) return redirect('/admin/spiele?error=fixture');

  if (action === 'delete') {
    const res = adminDeleteResult(matchId, admin);
    return redirect(res.ok ? '/admin/spiele?ok=deleted' : '/admin/spiele?error=fixture');
  }

  const res = adminSetResult(
    matchId,
    {
      typ: String(form.get('ergebnis_typ') ?? 'gespielt'),
      satz1: String(form.get('satz1') ?? ''),
      satz2: String(form.get('satz2') ?? ''),
      mtb: String(form.get('mtb') ?? ''),
      sieger: String(form.get('sieger') ?? ''),
    },
    admin,
  );
  if (!res.ok) return redirect(`/admin/spiele?error=${res.error === 'Unbekanntes Match.' ? 'fixture' : 'score'}`);

  return redirect('/admin/spiele?ok=saved');
};
