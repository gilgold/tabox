import { decideEntitlement } from './entitlement.js';
import { verifyGoogleToken } from './googleAuth.js';
import { verifyPaddleSignature, buildSubscriptionRecord, extractTransactionLink, shouldApply } from './paddleWebhook.js';
import { signEntitlementToken } from './jwt.js';
import {
  getSubscription,
  cancelSubscription,
  resumeSubscription,
  changePlan,
  toSubscriptionDto,
  toPreviewDto,
  planFromPriceId,
} from './subscriptionManagement.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) return null;
  return verifyGoogleToken(accessToken, env.GOOGLE_CLIENT_ID);
}

async function handleEntitlement(request, env) {
  const identity = await authenticate(request, env);
  if (!identity) return json({ error: 'invalid_token' }, 401);

  const raw = await env.ENTITLEMENTS.get(`ent:${identity.googleId}`);
  let record = null;
  if (raw) {
    try {
      record = JSON.parse(raw);
    } catch {
      record = null;
    }
  }
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
    console.warn('paddle webhook: unparseable signed body');
    return json({ ok: true });
  }
  const eventType = (event && event.event_type) || '';

  if (eventType.startsWith('transaction.')) {
    // Transaction events carry googleId (from checkout custom_data) + subscription_id.
    // Persist the link, then flush any subscription record that arrived first.
    const link = extractTransactionLink(event);
    if (link) {
      await env.ENTITLEMENTS.put(`map:${link.subscription_id}`, JSON.stringify({ googleId: link.googleId }));
      const pendingRaw = await env.ENTITLEMENTS.get(`subpending:${link.subscription_id}`);
      if (pendingRaw) {
        await applyEntitlement(env, link.googleId, JSON.parse(pendingRaw).record);
      }
    }
  } else if (eventType.startsWith('subscription.')) {
    // Subscription events carry lifecycle status but no googleId. Apply if the
    // subscription is already linked; otherwise stash until a transaction links it.
    const built = buildSubscriptionRecord(event, { monthly: env.PRICE_MONTHLY, annual: env.PRICE_ANNUAL });
    if (built) {
      const mapRaw = await env.ENTITLEMENTS.get(`map:${built.subscription_id}`);
      if (mapRaw) {
        await applyEntitlement(env, JSON.parse(mapRaw).googleId, built.record);
      } else {
        const pendingRaw = await env.ENTITLEMENTS.get(`subpending:${built.subscription_id}`);
        const pending = pendingRaw ? JSON.parse(pendingRaw).record : null;
        if (shouldApply(pending, built.record)) {
          await env.ENTITLEMENTS.put(`subpending:${built.subscription_id}`, JSON.stringify({ record: built.record }));
        }
      }
    }
  }
  return json({ ok: true });
}

// Resolve the caller's subscription id from their own entitlement record.
// Returns a Response (error) or { subscriptionId }.
async function requireSubscription(request, env) {
  const identity = await authenticate(request, env);
  if (!identity) return json({ error: 'invalid_token' }, 401);
  const raw = await env.ENTITLEMENTS.get(`ent:${identity.googleId}`);
  let record = null;
  if (raw) {
    try {
      record = JSON.parse(raw);
    } catch {
      record = null;
    }
  }
  if (!record || !record.subscription_id) return json({ error: 'no_subscription' }, 404);
  return { subscriptionId: record.subscription_id };
}

const priceMap = (env) => ({ monthly: env.PRICE_MONTHLY, annual: env.PRICE_ANNUAL });

const paddleError = (result) => json({ error: 'paddle_error', detail: result.detail }, 502);

async function handleGetSubscription(request, env) {
  const resolved = await requireSubscription(request, env);
  if (resolved instanceof Response) return resolved;
  const result = await getSubscription(env, resolved.subscriptionId);
  if (!result.ok) return paddleError(result);
  return json(toSubscriptionDto(result.data, priceMap(env)));
}

async function handleCancelSubscription(request, env) {
  const resolved = await requireSubscription(request, env);
  if (resolved instanceof Response) return resolved;
  const result = await cancelSubscription(env, resolved.subscriptionId);
  if (!result.ok) return paddleError(result);
  return json(toSubscriptionDto(result.data, priceMap(env)));
}

async function handleResumeSubscription(request, env) {
  const resolved = await requireSubscription(request, env);
  if (resolved instanceof Response) return resolved;
  // Only meaningful while a cancellation is scheduled — check live state so we
  // return a clear 409 instead of a Paddle validation error.
  const current = await getSubscription(env, resolved.subscriptionId);
  if (!current.ok) return paddleError(current);
  const change = current.data.scheduled_change;
  if (!change || change.action !== 'cancel') return json({ error: 'no_scheduled_cancel' }, 409);
  const result = await resumeSubscription(env, resolved.subscriptionId);
  if (!result.ok) return paddleError(result);
  return json(toSubscriptionDto(result.data, priceMap(env)));
}

async function handleChangePlan(request, env) {
  const resolved = await requireSubscription(request, env);
  if (resolved instanceof Response) return resolved;
  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const targetPlan = body && body.plan;
  if (targetPlan !== 'monthly' && targetPlan !== 'annual') return json({ error: 'invalid_plan' }, 400);

  const prices = priceMap(env);
  const current = await getSubscription(env, resolved.subscriptionId);
  if (!current.ok) return paddleError(current);
  const currentPriceId =
    (current.data.items && current.data.items[0] && current.data.items[0].price && current.data.items[0].price.id) || null;
  if (planFromPriceId(currentPriceId, prices) === targetPlan) return json({ error: 'already_on_plan' }, 409);

  const result = await changePlan(env, resolved.subscriptionId, prices[targetPlan], targetPlan, {
    preview: !!(body && body.preview),
    subscriptionStatus: current.data.status,
  });
  if (!result.ok) return paddleError(result);
  if (body && body.preview) return json(toPreviewDto(result.data));
  return json(toSubscriptionDto(result.data, prices));
}

// Upsert ent:<googleId>, honoring the out-of-order guard against the stored record.
async function applyEntitlement(env, googleId, record) {
  const key = `ent:${googleId}`;
  const existingRaw = await env.ENTITLEMENTS.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  if (shouldApply(existing, record)) {
    await env.ENTITLEMENTS.put(key, JSON.stringify(record));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // CORS preflight — the extension popup / any browser caller sends OPTIONS
    // before a GET that carries an Authorization header.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/entitlement') return handleEntitlement(request, env);
    if (request.method === 'GET' && url.pathname === '/subscription') return handleGetSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/cancel') return handleCancelSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/resume') return handleResumeSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/change-plan') return handleChangePlan(request, env);
    if (request.method === 'POST' && url.pathname === '/webhooks/paddle') return handlePaddleWebhook(request, env);
    return json({ error: 'not_found' }, 404);
  },
};
