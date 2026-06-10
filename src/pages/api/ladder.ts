import type { APIRoute } from 'astro';
import {
  createChallenge,
  decideChallengeResult,
  enterChallengeResult,
  fmtDatum,
  formatChallengeResult,
  getChallenge,
  joinLadder,
  leaveLadder,
  setChallengeTermin,
  withdrawChallenge,
  type Liste,
} from '../../lib/ladder';
import { getGeschlecht } from '../../lib/players';
import { adminEmails, emailsForNames } from '../../lib/notify';
import { sendMail, mailLayout, button } from '../../lib/mail';
import { isValidTermin } from '../../lib/termine';

// Forderungsliste (Tannenbaum-System) — Spieler-Aktionen: eintragen/austreten,
// fordern, zurückziehen, Termin pflegen, Ergebnis eintragen/bestätigen.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/forderung?error=notapproved');
  const me = user.player_name;

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const base = process.env.SITE_URL || new URL(request.url).origin;
  const listeName = (l: Liste) => (l === 'herren' ? 'Herren' : 'Damen');

  // Die eigene Liste ergibt sich aus dem Geschlecht (m→Herren, w→Damen).
  const eigeneListe = (): Liste | null => {
    const g = getGeschlecht(me);
    return g === 'm' ? 'herren' : g === 'w' ? 'damen' : null;
  };

  if (action === 'join') {
    const liste = eigeneListe();
    if (!liste) return redirect('/forderung?error=geschlecht');
    const res = joinLadder(liste, me);
    return redirect(res.ok ? '/forderung?ok=joined' : `/forderung?error=${res.error}`);
  }

  if (action === 'leave') {
    const liste = eigeneListe();
    if (!liste) return redirect('/forderung?error=geschlecht');
    const res = leaveLadder(liste, me);
    return redirect(res.ok ? '/forderung?ok=left' : `/forderung?error=${res.error}`);
  }

  if (action === 'challenge') {
    const liste = eigeneListe();
    if (!liste) return redirect('/forderung?error=geschlecht');
    const gegner = String(form.get('challenged') ?? '').trim();
    if (!gegner) return redirect('/forderung?error=input');
    const res = createChallenge(liste, me, gegner);
    if (!res.ok) return redirect(`/forderung?error=${res.error}`);
    const c = res.value!;

    const emails = emailsForNames([gegner]);
    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: `Du wurdest gefordert! (${listeName(liste)}-Forderungsliste)`,
        html: mailLayout(
          'Neue Forderung',
          `<p><strong>${me}</strong> fordert dich auf der ${listeName(liste)}-Forderungsliste.</p>
           <p>Das Match muss bis zum <strong>${fmtDatum(c.deadline)}</strong> gespielt sein
           (zwei Gewinnsätze, 3. Satz Match-Tiebreak). Bitte vereinbart einen Termin.</p>
           <p>${button(`${base}/forderung`, 'Zur Forderungsliste')}</p>`,
        ),
      });
    }
    return redirect('/forderung?ok=challenged');
  }

  // Ab hier: Aktionen auf einer konkreten Forderung.
  const challengeId = parseInt(String(form.get('challenge_id') ?? ''), 10);
  if (Number.isNaN(challengeId)) return redirect('/forderung?error=input');

  if (action === 'withdraw') {
    const res = withdrawChallenge(challengeId, { id: user.id, player_name: me });
    if (!res.ok) return redirect(`/forderung?error=${res.error}`);
    const c = res.value!;
    const emails = emailsForNames([c.challenged]);
    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: `Forderung zurückgezogen (${listeName(c.liste)})`,
        html: mailLayout(
          'Forderung zurückgezogen',
          `<p><strong>${me}</strong> hat die Forderung gegen dich zurückgezogen. Die Rangliste bleibt unverändert.</p>`,
        ),
      });
    }
    return redirect('/forderung?ok=withdrawn');
  }

  if (action === 'termin') {
    const c = getChallenge(challengeId);
    if (!c || c.status !== 'offen') return redirect('/forderung?error=gone');
    if (c.challenger !== me && c.challenged !== me) return redirect('/forderung?error=notyours');
    const termin = String(form.get('termin') ?? '').trim();
    if (termin && !isValidTermin(termin)) return redirect('/forderung?error=termin');
    setChallengeTermin(challengeId, termin || null);
    return redirect('/forderung?ok=termin');
  }

  if (action === 'enter') {
    const res = enterChallengeResult(challengeId, { id: user.id, player_name: me }, {
      typ: String(form.get('ergebnis_typ') ?? 'gespielt'),
      satz1: String(form.get('satz1') ?? ''),
      satz2: String(form.get('satz2') ?? ''),
      mtb: String(form.get('mtb') ?? ''),
      siegerRel: String(form.get('sieger_rel') ?? ''),
    });
    if (!res.ok) return redirect(`/forderung?error=${res.error}`);
    const c = res.value!;
    const opp = c.challenger === me ? c.challenged : c.challenger;
    const emails = emailsForNames([opp]);
    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: `Forderungs-Ergebnis bestätigen: ${c.challenger} vs ${c.challenged}`,
        html: mailLayout(
          'Ergebnis bestätigen',
          `<p>${me} hat für eure Forderung ein Ergebnis eingetragen:</p>
           <p><strong>${formatChallengeResult(c)}</strong> — Sieger: ${c.sieger === 'challenger' ? c.challenger : c.challenged}</p>
           <p>Bitte bestätige oder lehne das Ergebnis auf der Forderungsseite ab.</p>
           <p>${button(`${base}/forderung`, 'Zur Forderungsliste')}</p>`,
        ),
      });
    }
    return redirect('/forderung?ok=entered');
  }

  if (action === 'decide') {
    const decision = String(form.get('decision') ?? '');
    if (!['accept', 'reject'].includes(decision)) return redirect('/forderung?error=input');
    const before = getChallenge(challengeId);
    const res = decideChallengeResult(challengeId, { id: user.id, player_name: me }, decision === 'accept');
    if (!res.ok) return redirect(`/forderung?error=${res.error}`);
    const c = res.value!;

    if (decision === 'accept') {
      const siegerName = c.sieger === 'challenger' ? c.challenger : c.challenged;
      const emails = emailsForNames([c.challenger, c.challenged]);
      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: `Forderung entschieden: ${c.challenger} vs ${c.challenged}`,
          html: mailLayout(
            'Forderung entschieden',
            `<p>Das Ergebnis ist bestätigt: <strong>${formatChallengeResult(c)}</strong> — Sieger: <strong>${siegerName}</strong>.</p>
             <p>${c.sieger === 'challenger'
               ? `${c.challenger} übernimmt den Platz von ${c.challenged}; alle dazwischen rutschen einen Platz zurück.`
               : `Die Rangliste bleibt unverändert; ${c.challenger} hat 7 Tage Forderungssperre.`}
             Der Sieger ist 2 Tage geschützt und darf sofort erneut fordern.</p>
             <p>${button(`${base}/forderung`, 'Zur Forderungsliste')}</p>`,
          ),
        });
      }
      return redirect('/forderung?decided=accepted');
    }

    // Ablehnung: zurück auf "offen", Ranglistenbetreuer informieren.
    await sendMail({
      to: adminEmails(),
      subject: `Forderungs-Ergebnis abgelehnt: ${before?.challenger} vs ${before?.challenged}`,
      html: mailLayout(
        'Ergebnis abgelehnt',
        `<p>${me} hat das eingetragene Forderungs-Ergebnis abgelehnt
         (${before ? formatChallengeResult(before) : '–'}). Die Forderung steht wieder auf „offen" —
         bitte ggf. zwischen den Spielern klären.</p>
         <p>${button(`${base}/admin/forderung`, 'Zur Forderungs-Verwaltung')}</p>`,
      ),
    });
    return redirect('/forderung?decided=rejected');
  }

  return redirect('/forderung?error=input');
};
