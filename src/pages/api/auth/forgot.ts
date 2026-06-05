import type { APIRoute } from 'astro';
import { createResetToken, getUserByEmail, normalizeEmail } from '../../../lib/auth';
import { sendMail, mailLayout, button } from '../../../lib/mail';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') ?? ''));

  // Immer gleich antworten (keine Auskunft, ob die E-Mail existiert).
  const user = getUserByEmail(email);
  if (user) {
    const token = createResetToken(user.id);
    const base = process.env.SITE_URL || new URL(request.url).origin;
    const link = `${base}/passwort-zuruecksetzen?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: email,
      subject: 'Passwort zurücksetzen – Vereinsmeisterschaft',
      html: mailLayout(
        'Passwort zurücksetzen',
        `<p>Klicke auf den Button, um ein neues Passwort zu setzen. Der Link ist 60 Minuten gültig.</p>
         <p>${button(link, 'Neues Passwort setzen')}</p>
         <p style="font-size:12px;color:#8a8578">Falls du das nicht angefordert hast, ignoriere diese E-Mail.</p>`,
      ),
    });
  }

  return redirect('/passwort-vergessen?sent=1');
};
