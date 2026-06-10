import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { findFixtureById } from '../../lib/matchEntry';
import { decideTermin, formatTermin, getProposal, isValidTermin, proposeTermin } from '../../lib/termine';
import { emailsForNames } from '../../lib/notify';
import { sendMail, mailLayout, button } from '../../lib/mail';

// Terminvereinbarung: Spieler schlägt vor (propose), Gegenseite entscheidet (decide).
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const user = locals.user;
  if (!user) return redirect('/login');
  if (!user.player_name || user.claim_status !== 'approved') return redirect('/meine-spiele?error=notapproved');

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const base = process.env.SITE_URL || new URL(request.url).origin;

  if (action === 'propose') {
    const matchId = parseInt(String(form.get('match_id') ?? ''), 10);
    const termin = String(form.get('termin') ?? '').trim();
    if (Number.isNaN(matchId)) return redirect('/meine-spiele?error=fixture');
    if (!isValidTermin(termin)) return redirect('/meine-spiele?error=termin');

    const fixture = findFixtureById(matchId);
    if (!fixture) return redirect('/meine-spiele?error=fixture');
    if (fixture.seasonStatus !== 'aktiv') return redirect('/meine-spiele?error=archived');
    const onA = fixture.sideA.includes(user.player_name);
    const onB = fixture.sideB.includes(user.player_name);
    if (!onA && !onB) return redirect('/meine-spiele?error=notyours');
    if (fixture.sideA.length === 0 || fixture.sideB.length === 0) return redirect('/meine-spiele?error=fixture');
    // Für bereits gespielte/eingereichte Partien gibt es nichts zu terminieren.
    const played = getDb()
      .prepare("SELECT 1 FROM results WHERE match_id = ? AND status IN ('confirmed', 'pending') LIMIT 1")
      .get(matchId);
    if (played) return redirect('/meine-spiele?error=exists');

    proposeTermin(matchId, termin, user.id);

    const otherSide = onA ? fixture.sideB : fixture.sideA;
    const emails = emailsForNames(otherSide);
    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: `Terminvorschlag: ${fixture.wettbewerbLabel}`,
        html: mailLayout(
          'Terminvorschlag',
          `<p>${user.player_name} schlägt für euer Spiel <strong>${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}</strong>
           (${fixture.wettbewerbLabel}) einen Termin vor:</p>
           <p style="font-size:18px"><strong>${formatTermin(termin)}</strong></p>
           <p>Bitte bestätige oder lehne den Vorschlag unter „Meine Spiele" ab.</p>
           <p>${button(`${base}/meine-spiele`, 'Zu Meine Spiele')}</p>`,
        ),
      });
    }
    return redirect('/meine-spiele?termin=proposed');
  }

  if (action === 'decide') {
    const proposalId = parseInt(String(form.get('proposal_id') ?? ''), 10);
    const decision = String(form.get('decision') ?? '');
    if (Number.isNaN(proposalId) || !['accept', 'decline'].includes(decision)) return redirect('/meine-spiele?error=fixture');

    const proposal = getProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return redirect('/meine-spiele?error=gone');
    if (proposal.proposed_by === user.id) return redirect('/meine-spiele?error=ownresult');

    const fixture = findFixtureById(proposal.match_id);
    if (!fixture) return redirect('/meine-spiele?error=fixture');
    if (fixture.seasonStatus !== 'aktiv') return redirect('/meine-spiele?error=archived');
    const meOnA = fixture.sideA.includes(user.player_name);
    const meOnB = fixture.sideB.includes(user.player_name);
    if (!meOnA && !meOnB) return redirect('/meine-spiele?error=notyours');
    // Nur die Gegenseite des Vorschlagenden darf entscheiden.
    if (proposal.proposer_name) {
      const proposerOnA = fixture.sideA.includes(proposal.proposer_name);
      const sameSide = (proposerOnA && meOnA) || (!proposerOnA && meOnB);
      if (sameSide) return redirect('/meine-spiele?error=ownresult');
    }

    const decided = decideTermin(proposalId, user.id, decision === 'accept');
    if (!decided) return redirect('/meine-spiele?error=gone');

    const allNames = [...fixture.sideA, ...fixture.sideB];
    const title = `${fixture.sideA.join(' / ')} vs ${fixture.sideB.join(' / ')}`;
    if (decision === 'accept') {
      const emails = emailsForNames(allNames);
      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: `Termin bestätigt: ${title}`,
          html: mailLayout(
            'Termin steht',
            `<p>Der Termin für <strong>${title}</strong> (${fixture.wettbewerbLabel}) ist bestätigt:</p>
             <p style="font-size:18px"><strong>${formatTermin(proposal.termin)}</strong></p>
             <p>${button(`${base}/api/termin-ics?match_id=${fixture.matchId}`, 'Zum Kalender hinzufügen (ICS)')}</p>`,
          ),
        });
      }
      return redirect('/meine-spiele?termin=accepted');
    }

    const proposerEmails = proposal.proposer_name ? emailsForNames([proposal.proposer_name]) : [];
    if (proposerEmails.length > 0) {
      await sendMail({
        to: proposerEmails,
        subject: `Terminvorschlag abgelehnt: ${title}`,
        html: mailLayout(
          'Termin abgelehnt',
          `<p>${user.player_name} kann am vorgeschlagenen Termin (${formatTermin(proposal.termin)}) nicht.</p>
           <p>Bitte schlage unter „Meine Spiele" einen neuen Termin vor.</p>
           <p>${button(`${base}/meine-spiele`, 'Zu Meine Spiele')}</p>`,
        ),
      });
    }
    return redirect('/meine-spiele?termin=declined');
  }

  return redirect('/meine-spiele?error=fixture');
};
