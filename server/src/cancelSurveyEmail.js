// "Why did you cancel?" email, sent once when a Tabox Pro subscription is
// cancelled (scheduled or immediate). Links to the one-question survey on
// tabox.co. Same layout as every other Tabox email (emailLayout.js).
import { C, BRAND_FONT, esc, layout, primaryButton } from './emailLayout.js';

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// name: Paddle customer name (often null). accessUntil: ISO date Pro stays on
// until, or null when access already ended. surveyUrl: tabox.co survey link.
export function cancelSurveyEmail({ name, accessUntil, surveyUrl }) {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const until = accessUntil ? formatDate(accessUntil) : null;
  const subject = 'Quick question about cancelling Tabox Pro';
  const untilHtml = until
    ? `<div style="margin:0 0 24px;padding:16px 18px;border-left:3px solid ${C.accent};background:rgba(138,180,255,0.06);border-radius:0 14px 14px 0;">
        <p style="margin:0;font-size:15px;color:${C.muted};">You keep Pro until <strong style="color:${C.fg};">${esc(until)}</strong>. Changed your mind? Resume anytime from Tabox settings.</p>
      </div>`
    : '';
  const html = layout({
    preheader: 'One question, about 10 seconds. It helps us make Tabox better.',
    body: `
      <h1 style="margin:0 0 16px;font-family:${BRAND_FONT};font-weight:700;font-size:26px;line-height:1.3;color:${C.fg};">Sorry to see you go</h1>
      <p style="margin:0 0 16px;">Hi ${esc(firstName)}, thanks for trying Tabox Pro. Could you tell us why you cancelled? It's one question and takes about 10 seconds. Every answer is read by a human.</p>
      ${primaryButton(surveyUrl, 'Answer 1 question')}
      ${untilHtml}
      <p style="margin:0 0 16px;">Your collections, folders and saved tabs stay exactly where they are.</p>
      <p style="margin:0;">Prefer to just tell us? Reply to this email.</p>
      <p style="margin:20px 0 0;color:${C.fg};">Gil and the Tabox team</p>`,
  });
  const text = `Sorry to see you go

Hi ${firstName}, thanks for trying Tabox Pro. Could you tell us why you cancelled? It's one question and takes about 10 seconds. Every answer is read by a human.

Answer 1 question: ${surveyUrl}
${until ? `\nYou keep Pro until ${until}. Changed your mind? Resume anytime from Tabox settings.\n` : ''}
Your collections, folders and saved tabs stay exactly where they are.

Prefer to just tell us? Reply to this email.

Gil and the Tabox team

Organize Beautifully | https://www.tabox.co
Payments are processed by Paddle.com, our reseller.`;
  return { subject, html, text };
}
