import { decideEntitlement } from './entitlement.js';
import { verifyGoogleToken, exchangeGoogleToken } from './googleAuth.js';
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
import {
  isProUser, createSharedFolder, listSharedFolders, inviteMember, listInvites, respondInvite,
  getFolderDelta, putCollection, deleteCollection, updateFolderMeta,
  updateMemberRole, removeMember, deleteSharedFolder, getMembers,
  checkRateLimit, MAX_BODY_BYTES,
} from './sharedFolders.js';
import { listActivity, listComments, postComment, deleteComment } from './sharedActivity.js';
import {
  createOrRotateFolderLink, getFolderLink, deleteFolderLink, joinViaFolderLink,
  upsertCollectionLink, listCollectionLinks, deleteCollectionLink, getPublicLinkInfo,
} from './shareLinks.js';
import { JOIN_PAGE_HTML } from './joinPage.js';
import { validateAIRequest, completeAI } from './aiProxy.js';
import { handlePushSubscribe, handlePushUnsubscribe } from './pushRoutes.js';
import { notifyEmails, notifyFolderMembers } from './pushNotify.js';
import { handleAuthCallback } from './authCallback.js';

// How long an unlinked subscription event stays parked awaiting its transaction.
// Paddle retries webhooks for ~3 days; 30 days leaves ample slack.
const SUBPENDING_TTL_SECONDS = 30 * 24 * 60 * 60;

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
        await env.ENTITLEMENTS.delete(`subpending:${link.subscription_id}`);
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
          // TTL backstop: if the linking transaction never arrives, the parked
          // record self-expires instead of accumulating in KV forever.
          await env.ENTITLEMENTS.put(
            `subpending:${built.subscription_id}`,
            JSON.stringify({ record: built.record }),
            { expirationTtl: SUBPENDING_TTL_SECONDS }
          );
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

// AI completion proxy — Pro users only, rate-limited per user (burst +
// daily). Body caps and field allowlisting live in validateAIRequest.
async function handleAIComplete(request, env) {
  const identity = await authenticate(request, env);
  if (!identity) return json({ error: 'invalid_token' }, 401);
  // Entitlement gate before the rate limit: a pro_required rejection must not
  // consume quota (checkRateLimit increments as it checks).
  if (!(await isProUser(env, identity.googleId))) return json({ error: 'pro_required' }, 403);
  const declaredLen = Number(request.headers.get('content-length') || 0);
  if (declaredLen > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const now = Date.now();
  // Check the burst window first and short-circuit: checkRateLimit increments
  // as it checks, so a request already rejected by the burst limit must not
  // also consume daily quota.
  const burstOk = await checkRateLimit(env, identity.googleId, 'ai', 20, 60, now);
  const dayOk = burstOk && (await checkRateLimit(env, identity.googleId, 'ai-day', 500, 86400, now));
  if (!burstOk || !dayOk) return json({ error: 'rate_limited' }, 429);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const validated = validateAIRequest(body);
  if (!validated.ok) {
    return json({ error: validated.error }, validated.error === 'payload_too_large' ? 413 : 400);
  }
  const result = await completeAI(env, validated);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ content: result.content });
}

// Sentinel thrown by body() when the real request text exceeds MAX_BODY_BYTES;
// caught by handleShared's error boundary below and mapped to a 413 response.
class PayloadTooLargeError extends Error {}

async function handleShared(request, env, url, ctx) {
  try {
    const identity = await authenticate(request, env);
    if (!identity) return json({ error: 'invalid_token' }, 401);
    if (!identity.email) return json({ error: 'email_unavailable' }, 403);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      // Fast path: reject on the declared size before doing any work. This is
      // trust-but-verify — body() below re-checks the real byte count, since
      // chunked/dishonest requests can omit or fake content-length.
      const len = Number(request.headers.get('content-length') || 0);
      if (len > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
      const isInvite = request.method === 'POST' && url.pathname.endsWith('/invites');
      const allowed = isInvite
        ? await checkRateLimit(env, identity.googleId, 'invites', 30, 3600, Date.now())
        : await checkRateLimit(env, identity.googleId, 'writes', 120, 60, Date.now());
      if (!allowed) return json({ error: 'rate_limited' }, 429);
    }
    const db = env.SHARED_DB;
    const now = Date.now();
    const seg = url.pathname.split('/').filter(Boolean); // ['shared', ...]
    const method = request.method;
    const body = async () => {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) throw new PayloadTooLargeError();
      try { return JSON.parse(text); } catch { return {}; }
    };
    const out = (r) => (r.ok === false ? json({ error: r.error }, r.status) : json(r.data, 200));
    // Content-free push tickles: fire-and-forget via ctx.waitUntil so they
    // never delay or fail the response. Guarded with `ctx &&` so tests that
    // call handleShared without a ctx still pass. The actor is included on
    // purpose — their own OTHER devices need the tickle (same-account
    // multi-device liveness); see notifyFolderMembers' doc comment.
    const tickle = (folderId, opts = {}) =>
      ctx && ctx.waitUntil(notifyFolderMembers(env, db, folderId, {
        payload: { folderId }, ...opts,
      }));
    const tickleInvite = (email) =>
      ctx && ctx.waitUntil(notifyEmails(env, db, [email], { invite: true }));

    if (seg[1] === 'invites') {
      if (method === 'GET' && seg.length === 2) return out(await listInvites(db, identity));
      if (method === 'POST' && seg.length === 4 && seg[3] === 'respond') {
        const { accept } = await body();
        // The ACCEPTING user's entitlement caps the granted role (free -> read).
        const opts = accept === true ? { isPro: await isProUser(env, identity.googleId) } : {};
        const r = await respondInvite(db, identity, seg[2], accept === true, now, opts);
        if (r.ok !== false) tickle(seg[2]);
        return out(r);
      }
      return json({ error: 'not_found' }, 404);
    }

    const joinUrl = (token) => `${url.origin}/join/${token}`;

    if (seg[1] === 'join-link' && method === 'POST' && seg.length === 2) {
      // The JOINING user's entitlement caps the granted role (free -> read).
      const isPro = await isProUser(env, identity.googleId);
      const r = await joinViaFolderLink(db, identity, (await body()).token, now, { isPro });
      if (r.ok !== false) tickle(r.data.folder.folderId);
      return out(r);
    }
    if (seg[1] === 'collection-link' && seg.length === 2 && method === 'PUT') {
      if (!(await isProUser(env, identity.googleId))) return json({ error: 'pro_required' }, 403);
      const r = await upsertCollectionLink(db, identity, await body(), now);
      if (r.ok) r.data.url = joinUrl(r.data.token);
      return out(r);
    }
    if (seg[1] === 'collection-links' && seg.length === 2 && method === 'GET') {
      const r = await listCollectionLinks(db, identity);
      if (r.ok) r.data.links = r.data.links.map((l) => ({ ...l, url: joinUrl(l.token) }));
      return out(r);
    }
    if (seg[1] === 'collection-link' && seg.length === 3 && method === 'DELETE') {
      return out(await deleteCollectionLink(db, identity, decodeURIComponent(seg[2])));
    }

    if (seg[1] !== 'folders') return json({ error: 'not_found' }, 404);

    if (seg.length === 2) {
      if (method === 'GET') return out(await listSharedFolders(db, identity));
      if (method === 'POST') {
        if (!(await isProUser(env, identity.googleId))) return json({ error: 'pro_required' }, 403);
        return out(await createSharedFolder(db, identity, await body(), now));
      }
    }
    const folderId = decodeURIComponent(seg[2] || '');
    if (seg.length === 3) {
      if (method === 'GET') return out(await getFolderDelta(db, identity, folderId, url.searchParams.get('sinceRev')));
      if (method === 'PATCH') {
        const r = await updateFolderMeta(db, identity, folderId, await body(), now);
        if (r.ok !== false) tickle(folderId);
        return out(r);
      }
      if (method === 'DELETE') {
        // Capture active member emails (+ owner) BEFORE deleting —
        // shared_members rows and the shared_folders row itself CASCADE away
        // with the folder, so notifyFolderMembers would find none afterward.
        // The owner isn't a shared_members row, so it's pulled separately
        // from shared_folders here (usually the owner IS the acting user on
        // this route, but an admin/future path shouldn't silently skip them).
        const { results: preMembers } = await db.prepare(
          "SELECT email FROM shared_members WHERE folder_id = ? AND status = 'active'"
        ).bind(folderId).all();
        const preFolder = await db.prepare('SELECT owner_email FROM shared_folders WHERE id = ?')
          .bind(folderId).first();
        const r = await deleteSharedFolder(db, identity, folderId);
        if (r.ok !== false) {
          // The acting user is NOT excluded (same-account multi-device fix):
          // their other devices need the tickle to drop the folder live.
          // notifyEmails dedups, so owner-as-member double entries are fine.
          const emails = (preMembers || []).map((m) => m.email);
          if (preFolder && preFolder.owner_email) emails.push(preFolder.owner_email);
          if (ctx && emails.length) ctx.waitUntil(notifyEmails(env, db, emails, { folderId }));
        }
        return out(r);
      }
    }
    if (seg.length === 4 && seg[3] === 'link') {
      if (method === 'POST') {
        if (!(await isProUser(env, identity.googleId))) return json({ error: 'pro_required' }, 403);
        // Each re-graded member's OWN entitlement caps upgrades (free -> read),
        // mirroring the join-time gate in joinViaFolderLink.
        const r = await createOrRotateFolderLink(db, identity, folderId, await body(), now, {
          isProMember: (googleId) => isProUser(env, googleId),
        });
        if (r.ok) {
          r.data.url = joinUrl(r.data.token);
          if (r.data.updatedMembers?.length) {
            tickle(folderId, { extraEmails: r.data.updatedMembers.map((m) => m.email) });
          }
        }
        return out(r);
      }
      if (method === 'GET') {
        const r = await getFolderLink(db, identity, folderId);
        if (r.ok && r.data.link) r.data.link = { ...r.data.link, url: joinUrl(r.data.link.token) };
        return out(r);
      }
      if (method === 'DELETE') return out(await deleteFolderLink(db, identity, folderId));
    }
    if (seg.length === 4 && seg[3] === 'invites' && method === 'POST') {
      if (!(await isProUser(env, identity.googleId))) return json({ error: 'pro_required' }, 403);
      const invitePayload = await body();
      const r = await inviteMember(db, identity, folderId, invitePayload, now);
      if (r.ok !== false) tickleInvite(invitePayload.email);
      return out(r);
    }
    if (seg.length === 4 && seg[3] === 'activity' && method === 'GET') {
      // beforeId/limit: absent -> defaults; present-but-garbage -> 400 inside
      // listActivity (isGarbageBaseRev precedent).
      return out(await listActivity(db, identity, folderId, {
        beforeId: url.searchParams.get('beforeId') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      }));
    }
    if (seg.length === 4 && seg[3] === 'comments') {
      if (method === 'GET') {
        // Absent collectionUid = the folder-level thread.
        return out(await listComments(db, identity, folderId, {
          collectionUid: url.searchParams.get('collectionUid') || null,
          beforeId: url.searchParams.get('beforeId') ?? undefined,
          limit: url.searchParams.get('limit') ?? undefined,
        }));
      }
      if (method === 'POST') {
        // Membership is checked inside postComment first (non-members 404);
        // the POSTING user's live entitlement gates posting (403 pro_required).
        const isPro = await isProUser(env, identity.googleId);
        const r = await postComment(db, identity, folderId, await body(), now, { isPro });
        if (r.ok !== false) tickle(folderId);
        return out(r);
      }
    }
    if (seg.length === 5 && seg[3] === 'comments' && method === 'DELETE') {
      const r = await deleteComment(db, identity, folderId, decodeURIComponent(seg[4]));
      if (r.ok !== false) tickle(folderId);
      return out(r);
    }
    if (seg.length === 4 && seg[3] === 'members' && method === 'GET') {
      return out(await getMembers(db, identity, folderId));
    }
    if (seg.length === 5 && seg[3] === 'members') {
      const email = decodeURIComponent(seg[4]);
      if (method === 'PATCH') {
        const r = await updateMemberRole(db, identity, folderId, email, (await body()).role, now);
        if (r.ok !== false) tickle(folderId, { extraEmails: [email] });
        return out(r);
      }
      if (method === 'DELETE') {
        const r = await removeMember(db, identity, folderId, email, now);
        // Self-leave: the departing user is the actor, so don't tickle them
        // for their own removal (extraEmails would re-add them past exceptEmail).
        const selfLeave = email.toLowerCase() === identity.email.toLowerCase();
        if (r.ok !== false) tickle(folderId, selfLeave ? {} : { extraEmails: [email] });
        return out(r);
      }
    }
    if (seg.length === 5 && seg[3] === 'collections') {
      const uid = decodeURIComponent(seg[4]);
      if (method === 'PUT') {
        const r = await putCollection(db, identity, folderId, uid, await body(), now);
        if (r.ok !== false) tickle(folderId);
        return out(r);
      }
      if (method === 'DELETE') {
        // B5: DELETE has no body, so an optional conflict-check baseRev rides
        // as a query param instead. Absent -> undefined (delete always wins,
        // preserving prior behavior); present -> forwarded as-is (including
        // garbage, e.g. non-numeric) so deleteCollection's own validation
        // returns the same 400 putCollection would for a garbage baseRev.
        const rawBaseRev = url.searchParams.get('baseRev');
        const baseRev = rawBaseRev === null ? undefined : Number(rawBaseRev);
        const r = await deleteCollection(db, identity, folderId, uid, now, baseRev);
        if (r.ok !== false) tickle(folderId);
        return out(r);
      }
    }
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return json({ error: 'payload_too_large' }, 413);
    console.error('handleShared error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}

async function handlePush(request, env) {
  const identity = await authenticate(request, env);
  if (!identity) return json({ error: 'invalid_token' }, 401);
  if (!identity.email) return json({ error: 'email_unavailable' }, 403);
  const allowed = await checkRateLimit(env, identity.googleId, 'writes', 120, 60, Date.now());
  if (!allowed) return json({ error: 'rate_limited' }, 429);
  let body;
  try { body = JSON.parse(await request.text()); } catch { body = {}; }
  const r = request.method === 'POST'
    ? await handlePushSubscribe(env.SHARED_DB, identity, body, Date.now())
    : await handlePushUnsubscribe(env.SHARED_DB, identity, body);
  return r.ok === false ? json({ error: r.error }, r.status) : json(r.data, 200);
}

// Public, unauthenticated token resolution for the join page and the extension.
// The unguessable token is the only credential; rate-limit per client IP to
// blunt token scanning. Folder links expose metadata only (see getPublicLinkInfo).
async function handlePublicLink(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `ip:${ip}`, 'links', 30, 60, Date.now());
  if (!allowed) return json({ error: 'rate_limited' }, 429);
  const token = decodeURIComponent(url.pathname.slice('/links/'.length));
  const r = await getPublicLinkInfo(env.SHARED_DB, token);
  return r.ok === false ? json({ error: r.error }, r.status) : json(r.data, 200);
}

// Server-side OAuth token exchange for the extension. Unauthenticated by
// design (this IS the login step) — the unguessable auth code / refresh token
// is the credential. Per-IP rate limit blunts brute-force / abuse of the
// proxy; Google validates the actual grant.
async function handleAuthToken(request, env) {
  if (!env.GOOGLE_CLIENT_SECRET) return json({ error: 'not_configured' }, 500);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `ip:${ip}`, 'auth', 30, 60, Date.now());
  if (!allowed) return json({ error: 'rate_limited' }, 429);
  let body;
  try { body = JSON.parse(await request.text()); } catch { body = null; }
  const result = await exchangeGoogleToken(body, {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    selfOrigin: new URL(request.url).origin,
  });
  return json(result.body, result.status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // CORS preflight — the extension popup / any browser caller sends OPTIONS
    // before a GET that carries an Authorization header.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/auth/token') return handleAuthToken(request, env);
    if (request.method === 'GET' && url.pathname === '/auth/callback') return handleAuthCallback(request);
    if (request.method === 'GET' && url.pathname === '/entitlement') return handleEntitlement(request, env);
    if (request.method === 'POST' && url.pathname === '/ai/complete') return handleAIComplete(request, env);
    if (request.method === 'GET' && url.pathname === '/subscription') return handleGetSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/cancel') return handleCancelSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/resume') return handleResumeSubscription(request, env);
    if (request.method === 'POST' && url.pathname === '/subscription/change-plan') return handleChangePlan(request, env);
    if (request.method === 'GET' && url.pathname.startsWith('/links/')) return handlePublicLink(request, env, url);
    if (request.method === 'GET' && url.pathname.startsWith('/join/')) {
      return new Response(JOIN_PAGE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/shared/')) return handleShared(request, env, url, ctx);
    if (url.pathname === '/push/subscribe' && (request.method === 'POST' || request.method === 'DELETE')) {
      return handlePush(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/paddle') return handlePaddleWebhook(request, env);
    return json({ error: 'not_found' }, 404);
  },
};
