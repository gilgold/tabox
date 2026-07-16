const SIGNATURE_TOLERANCE_S = 900; // 15 min

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
  return hex === h1;
}

export function extractEntitlementUpdate(event, priceMap) {
  if (!event || typeof event.event_type !== 'string' || !event.event_type.startsWith('subscription.')) return null;
  const sub = event.data;
  const googleId = sub && sub.custom_data && sub.custom_data.googleId;
  if (!googleId) return null;
  const priceId = (sub.items && sub.items[0] && sub.items[0].price && sub.items[0].price.id) || null;
  const plan = priceId === priceMap.monthly ? 'monthly' : priceId === priceMap.annual ? 'annual' : null;
  return {
    googleId,
    record: {
      status: sub.status,
      plan,
      current_period_end: (sub.current_billing_period && sub.current_billing_period.ends_at) || null,
      subscription_id: sub.id,
      customer_id: sub.customer_id,
      occurred_at: event.occurred_at,
    },
  };
}

export function shouldApply(existing, incoming) {
  if (!existing || !existing.occurred_at) return true;
  return Date.parse(incoming.occurred_at) >= Date.parse(existing.occurred_at);
}
