import { decideEntitlement } from './entitlement.js';
import { verifyGoogleToken } from './googleAuth.js';
import { verifyPaddleSignature, extractEntitlementUpdate, shouldApply } from './paddleWebhook.js';
import { signEntitlementToken } from './jwt.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

async function handleEntitlement(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) return json({ error: 'invalid_token' }, 401);

  const identity = await verifyGoogleToken(accessToken, env.GOOGLE_CLIENT_ID);
  if (!identity) return json({ error: 'invalid_token' }, 401);

  const raw = await env.ENTITLEMENTS.get(`ent:${identity.googleId}`);
  const record = raw ? JSON.parse(raw) : null;
  const decision = decideEntitlement(record);
  const token = decision.entitled
    ? await signEntitlementToken({ sub: identity.googleId, ent: decision.status, plan: decision.plan }, env.JWT_SECRET)
    : null;
  return json({ ...decision, token, checkedAt: new Date().toISOString() });
}

async function handlePaddleWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('Paddle-Signature');
  const valid = await verifyPaddleSignature(rawBody, signature, env.PADDLE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Validly signed but unprocessable payload — acknowledge so Paddle stops retrying.
    return json({ ok: true });
  }
  const update = extractEntitlementUpdate(event, { monthly: env.PRICE_MONTHLY, annual: env.PRICE_ANNUAL });
  if (update) {
    const key = `ent:${update.googleId}`;
    const existingRaw = await env.ENTITLEMENTS.get(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    if (shouldApply(existing, update.record)) {
      await env.ENTITLEMENTS.put(key, JSON.stringify(update.record));
    }
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/entitlement') return handleEntitlement(request, env);
    if (request.method === 'POST' && url.pathname === '/webhooks/paddle') return handlePaddleWebhook(request, env);
    return json({ error: 'not_found' }, 404);
  },
};
