// E-Mail-Versand via Resend. Ohne RESEND_API_KEY (lokale Entwicklung) wird die
// Mail nur in die Konsole geloggt, damit man Magic-Links/Tokens testen kann.
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || 'TC Muckensturm <onboarding@resend.dev>';
const resend = apiKey ? new Resend(apiKey) : null;

export async function sendMail(opts: { to: string | string[]; subject: string; html: string }): Promise<void> {
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  if (!resend) {
    const links = Array.from(opts.html.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
    console.log('\n[MAIL:dev] ----------------------------------------');
    console.log('An:', to.join(', '));
    console.log('Betreff:', opts.subject);
    console.log('Text:', opts.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    for (const l of links) console.log('Link:', l);
    console.log('-------------------------------------------------\n');
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject: opts.subject, html: opts.html });
  if (error) {
    console.error('[MAIL] Resend-Fehler:', error);
    throw new Error('Mailversand fehlgeschlagen');
  }
}

// Einfaches HTML-Grundgerüst für transaktionale Mails.
export function mailLayout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a1f2e">
    <h2 style="color:#1c4c80">${title}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e3ddd2;margin:24px 0" />
    <p style="font-size:12px;color:#8a8578">TC Muckensturm · Vereinsmeisterschaft</p>
  </div>`;
}

export function button(href: string, label: string, color = '#1c4c80'): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:bold">${label}</a>`;
}
