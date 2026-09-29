// HTML + text body for the "payment failed" email sent through Resend when a
// Tabox Pro subscription goes past_due. Layout lives in emailLayout.js.

import { SITE_URL, C, BRAND_FONT, esc, layout, primaryButton } from './emailLayout.js';

// Amber-accented callout, same shape as the contact email's quote block. No
// date: in a past_due payload current_billing_period has already advanced to
// the unpaid period, and access really ends when Paddle's retries give up
// (about 4 days) and cancel the subscription.
const GRACE_BLOCK = `<div style="margin:0 0 24px;padding:16px 18px;border-left:3px solid ${C.warn};background:rgba(245,158,11,0.06);border-radius:0 14px 14px 0;">
        <p style="margin:0 0 4px;font-family:${BRAND_FONT};font-weight:700;font-size:16px;color:${C.fg};">Pro is still on for now</p>
        <p style="margin:0;font-size:15px;color:${C.muted};">We'll retry the charge over the next few days. Updating your card now makes sure the next attempt goes through and Pro isn't interrupted.</p>
      </div>`;

const PLAN_LABEL = { monthly: 'monthly', annual: 'annual' };

// name: Paddle customer name (often null). plan: 'monthly' | 'annual' | null.
// updatePaymentUrl: the Worker's /billing/payment-method redirect, which mints
// a fresh Paddle portal link on click (Paddle's own links are temporary).
export function paymentFailedEmail({ name, plan, updatePaymentUrl }) {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const planText = PLAN_LABEL[plan] ? `${PLAN_LABEL[plan]} Tabox Pro plan` : 'Tabox Pro plan';
  const subject = "Your Tabox Pro payment didn't go through";
  const html = layout({
    preheader: 'Update your payment method to keep Tabox Pro. Your saved tabs are safe.',
    body: `
      <h1 style="margin:0 0 16px;font-family:${BRAND_FONT};font-weight:700;font-size:26px;line-height:1.3;color:${C.fg};">Your payment didn't go through</h1>
      <p style="margin:0 0 16px;">Hi ${esc(firstName)}, we tried to charge your card for your ${planText}, but the payment was declined. This usually means the card expired, was replaced, or the bank flagged the payment.</p>
      ${GRACE_BLOCK}
      <p style="margin:0 0 8px;">It takes about a minute to fix:</p>
      ${primaryButton(updatePaymentUrl, 'Update payment method')}
      <p style="margin:0 0 16px;">Your collections, folders and saved tabs are never deleted. If the payment isn't resolved, only the Pro features pause, and they come back as soon as you resubscribe.</p>
      <p style="margin:0;">Questions, or think this is a mistake? Just reply to this email.</p>
      <p style="margin:20px 0 0;color:${C.fg};">Gil and the Tabox team</p>`,
  });
  const text = `Your payment didn't go through

Hi ${firstName}, we tried to charge your card for your ${planText}, but the payment was declined. This usually means the card expired, was replaced, or the bank flagged the payment.

Pro is still on for now. We'll retry the charge over the next few days. Updating your card now makes sure the next attempt goes through and Pro isn't interrupted.

Update your payment method: ${updatePaymentUrl}

Your collections, folders and saved tabs are never deleted. If the payment isn't resolved, only the Pro features pause, and they come back as soon as you resubscribe.

Questions, or think this is a mistake? Just reply to this email.

Gil and the Tabox team

Organize Beautifully | ${SITE_URL}
Payments are processed by Paddle.com, our reseller.`;
  return { subject, html, text };
}
