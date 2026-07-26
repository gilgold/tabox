// Push subscription registry. Rows are self-pruning: pushNotify.js deletes a
// row when the push service answers 404/410, and subscribe caps at
// MAX_SUBS_PER_USER by evicting the oldest.
const MAX_SUBS_PER_USER = 8;
const MAX_ENDPOINT_LEN = 1024;
const MAX_KEY_LEN = 256;

function validSubscription(body) {
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LEN) return null;
  try {
    if (new URL(endpoint).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (typeof p256dh !== 'string' || !p256dh || p256dh.length > MAX_KEY_LEN) return null;
  if (typeof auth !== 'string' || !auth || auth.length > MAX_KEY_LEN) return null;
  return { endpoint, p256dh, auth };
}

export async function handlePushSubscribe(db, identity, body, now) {
  const sub = validSubscription(body);
  if (!sub) return { ok: false, error: 'invalid_subscription', status: 400 };
  const email = identity.email.toLowerCase();
  await db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_email = excluded.user_email,
       p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(sub.endpoint, email, sub.p256dh, sub.auth, now).run();
  // Evict oldest beyond the cap (multi-device users keep the newest 8).
  await db.prepare(
    `DELETE FROM push_subscriptions WHERE user_email = ? AND endpoint NOT IN (
       SELECT endpoint FROM push_subscriptions WHERE user_email = ?
       ORDER BY created_at DESC LIMIT ?)`
  ).bind(email, email, MAX_SUBS_PER_USER).run();
  return { ok: true, data: {} };
}

export async function handlePushUnsubscribe(db, identity, body) {
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
  if (endpoint) {
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?')
      .bind(endpoint, identity.email.toLowerCase()).run();
  }
  return { ok: true, data: {} };
}
