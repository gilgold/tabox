// HTML + text body for the "payment failed" email sent through Resend when a
// Tabox Pro subscription goes past_due. The layout mirrors the tabox.co
// contact emails (tabox-homepage app/lib/contactEmails.js) so every Tabox email
// looks the same. Email clients ignore <style> blocks and CSS variables, so
// brand values are inlined as literals.

const SITE_URL = 'https://www.tabox.co';

const C = {
  bg: '#05070f',
  card: '#0b0f1d',
  border: '#1c2233',
  fg: '#ffffff',
  muted: '#E5E9F7',
  faint: '#667089',
  accent: '#8ab4ff',
  warn: '#F59E0B',
};
const BRAND_FONT = "Comfortaa, 'Trebuchet MS', Arial, sans-serif";
const BODY_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 4-stop brand gradient as a hairline bar. Clients that drop CSS gradients
// (Outlook) fall back to the solid blue first stop.
const GRADIENT_BAR = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td height="4" style="height:4px;line-height:4px;font-size:0;background:#2563EB;background-image:linear-gradient(90deg,#2563EB,#7C3AED 35%,#DB2777 65%,#F59E0B);">&nbsp;</td>
  </tr>
</table>`;

function layout({ preheader, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@700&display=swap" rel="stylesheet">
<title>Tabox</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 24px;">
            <a href="${SITE_URL}" style="text-decoration:none;">
              <img src="${SITE_URL}/tabox-logo.png" width="36" height="36" alt="" style="vertical-align:middle;border:0;">
              <span style="vertical-align:middle;font-family:${BRAND_FONT};font-weight:700;font-size:26px;color:${C.fg};padding-left:10px;">Tabox</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:${C.card};border:1px solid ${C.border};border-radius:22px;overflow:hidden;">
            ${GRADIENT_BAR}
            <div style="padding:36px 32px 32px;font-family:${BODY_FONT};color:${C.muted};font-size:16px;line-height:1.6;">
              ${body}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 4px 0;font-family:${BODY_FONT};font-size:13px;line-height:1.6;color:${C.faint};">
            <div style="font-family:${BRAND_FONT};font-weight:700;font-size:15px;color:#b98cff;padding-bottom:6px;">Organize Beautifully</div>
            <a href="${SITE_URL}" style="color:${C.faint};text-decoration:underline;">tabox.co</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}/using-tabox" style="color:${C.faint};text-decoration:underline;">Help center</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}/privacy" style="color:${C.faint};text-decoration:underline;">Privacy</a>
            <div style="padding-top:10px;">You're receiving this because you have a Tabox Pro subscription. Payments are processed by Paddle.com, our reseller.</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function primaryButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr>
          <td style="border-radius:999px;background:#2b2150;background-image:linear-gradient(115deg,#1e2c5a,#3b2268 50%,#52203f);border:1px solid rgba(255,255,255,0.18);">
            <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${BODY_FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
          </td>
        </tr>
      </table>`;
}

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
