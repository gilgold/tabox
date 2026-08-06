const SIGNATURE_TOLERANCE_S = 900; // 15 min

// Constant-time hex comparison (no Node crypto in Cloudflare Workers).
// Length mismatch returns early, but equal-length inputs are always scanned fully.
function timingSafeEqualHex(a, b) {
  if (typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPaddleSignature(rawBody, signatureHeader, secret, nowMs = Date.now()) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((p) => p.split('=')).filter((kv) => kv.length === 2)
  );
  const { ts, h1 } = parts;
  if (!ts || !h1) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_S) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${rawBody}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqualHex(hex, h1);
}

// Build the entitlement record from a subscription.* event. Paddle subscription
// webhooks carry the lifecycle status but NOT the checkout's custom_data, so this
// yields no googleId — it's keyed by subscription_id and linked to a Google user
// via a transaction.* event (see extractTransactionLink).
export function buildSubscriptionRecord(event, priceMap) {
  if (!event || typeof event.event_type !== 'string' || !event.event_type.startsWith('subscription.')) return null;
  const sub = event.data;
  if (!sub || !sub.id) return null;
  const priceId = (sub.items && sub.items[0] && sub.items[0].price && sub.items[0].price.id) || null;
  const plan = priceId === priceMap.monthly ? 'monthly' : priceId === priceMap.annual ? 'annual' : null;
  return {
    subscription_id: sub.id,
    record: {
      status: sub.status,
      plan,
      current_period_end: (sub.current_billing_period && sub.current_billing_period.ends_at) || null,
      scheduled_cancel_at:
        (sub.scheduled_change && sub.scheduled_change.action === 'cancel' && sub.scheduled_change.effective_at) || null,
      subscription_id: sub.id,
      customer_id: sub.customer_id,
      occurred_at: event.occurred_at,
    },
  };
}

// A transaction.* event carries the checkout's custom_data (hence googleId) and,
// once a subscription exists, its subscription_id — the link the subscription
// events lack.
export function extractTransactionLink(event) {
  if (!event || typeof event.event_type !== 'string' || !event.event_type.startsWith('transaction.')) return null;
  const t = event.data;
  const googleId = t && t.custom_data && t.custom_data.googleId;
  const subscription_id = t && t.subscription_id;
  if (!googleId || !subscription_id) return null;
  return { googleId, subscription_id };
}

export function shouldApply(existing, incoming) {
  const incomingTs = Date.parse(incoming && incoming.occurred_at);
  if (Number.isNaN(incomingTs)) return false; // drop events without a valid occurred_at
  if (!existing || !existing.occurred_at) return true;
  return incomingTs >= Date.parse(existing.occurred_at);
}
