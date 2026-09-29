// "Payment failed" email for Tabox Pro subscriptions that go past_due.
//
// Trigger: the subscription.past_due webhook (fires once per transition to
// past_due). The email links to GET /billing/payment-method on this Worker
// rather than to Paddle directly: Paddle's management_urls carry a temporary
// customer-portal token, are excluded from webhook payloads, and mustn't be
// stored. The redirect route fetches the subscription at click time and
// forwards to a fresh update_payment_method link.
import { paddleFetch, getSubscription, planFromPriceId } from './subscriptionManagement.js';
import { signPurposeToken, verifyPurposeToken } from './jwt.js';
import { paymentFailedEmail } from './paymentFailedEmail.js';
import { FROM, REPLY_TO, sendResend } from './resend.js';

const LINK_PURPOSE = 'update-pm';
// Paddle cancels a past_due subscription after ~4 days, but the link stays
// useful afterwards (the portal still lets the customer fix billing), so keep
// it valid well beyond that.
const LINK_TTL_S = 45 * 24 * 60 * 60;
// One email per failed billing period. Outlives the retry window.
const SENT_TTL_S = 60 * 24 * 60 * 60;
const FALLBACK_URL = 'https://www.tabox.co/contact';

// Only automatically-collected subscriptions have a card to update; manual
// (invoiced) ones are paid by invoice and get Paddle's invoice emails.
export function isPaymentFailedEvent(event) {
  if (!event || event.event_type !== 'subscription.past_due') return false;
  const sub = event.data;
  return !!(sub && sub.id && sub.customer_id && sub.status === 'past_due' && sub.collection_mode !== 'manual');
}

// Dedupe key: the unpaid period's start identifies one failed renewal, so
// Paddle redeliveries and repeat past_due transitions within the same period
// don't send a second email, while next year's failure still does.
// Marks "this subscription got a payment-failed email". The cancel survey uses it
// to tell a dunning cancel (involuntary) from a voluntary one.
export const paymentFailedSubKey = (sid) => `pmfail-sub:${sid}`;

export function sentKey(sub) {
  const period = (sub.current_billing_period && sub.current_billing_period.starts_at) || 'unknown';
  return `pmfail:${sub.id}:${period}`;
}

// Never throws — runs under ctx.waitUntil after the webhook has been acked.
export async function notifyPaymentFailed(env, event, origin, priceMap) {
  try {
    if (!isPaymentFailedEvent(event)) return { sent: false, reason: 'not_applicable' };
    if (!env.RESEND_API_KEY) {
      console.warn('payment-failed email: RESEND_API_KEY is not set');
      return { sent: false, reason: 'no_resend_key' };
    }
    const sub = event.data;
    const key = sentKey(sub);
    if (await env.ENTITLEMENTS.get(key)) return { sent: false, reason: 'already_sent' };

    const customer = await paddleFetch(env, `/customers/${sub.customer_id}`);
    const email = customer.ok && customer.data && customer.data.email;
    if (!email) {
      console.warn('payment-failed email: no customer email', sub.id, customer.detail);
      return { sent: false, reason: 'no_email' };
    }

    const priceId = (sub.items && sub.items[0] && sub.items[0].price && sub.items[0].price.id) || null;
    const token = await signPurposeToken(LINK_PURPOSE, { sid: sub.id }, env.JWT_SECRET, LINK_TTL_S);
    const updatePaymentUrl = `${origin}/billing/payment-method?t=${encodeURIComponent(token)}`;
    const mail = paymentFailedEmail({
      name: customer.data.name,
      plan: planFromPriceId(priceId, priceMap),
      updatePaymentUrl,
    });
    await sendResend(env, { from: FROM, to: [email], reply_to: REPLY_TO, ...mail });
    await env.ENTITLEMENTS.put(key, JSON.stringify({ sent_at: new Date().toISOString() }), { expirationTtl: SENT_TTL_S });
    await env.ENTITLEMENTS.put(paymentFailedSubKey(sub.id), JSON.stringify({ sent_at: new Date().toISOString() }), { expirationTtl: SENT_TTL_S });
    return { sent: true };
  } catch (err) {
    console.error('payment-failed email: send failed', err);
    return { sent: false, reason: 'error' };
  }
}

const redirect = (location) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });

// GET /billing/payment-method?t=<token> — the email's button. Mints a fresh
// Paddle link at click time. Falls back to the general customer portal (email
// sign-in) when the subscription can't be fetched, then to the contact page.
export async function handlePaymentMethodRedirect(env, url) {
  const payload = await verifyPurposeToken(LINK_PURPOSE, url.searchParams.get('t'), env.JWT_SECRET);
  const portal = env.PADDLE_PORTAL_URL || FALLBACK_URL;
  if (!payload || typeof payload.sid !== 'string') return redirect(portal);
  const result = await getSubscription(env, payload.sid);
  const link = result.ok && result.data && result.data.management_urls && result.data.management_urls.update_payment_method;
  return redirect(link || portal);
}
