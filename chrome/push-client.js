/* eslint-disable no-undef */
// Web Push subscription lifecycle for the shared-folders tickle channel.
// Loaded via importScripts from background.js (after background-utils.js and
// pro-config.js) — the require/globalThis guards let Jest pull this file in
// directly, mirroring chrome/shared-folders.js and chrome/ai-client.js.
//
// The server stores subscriptions per user; ensurePushSubscription is safe to
// call often (idempotent, re-registers at most daily unless forced).

const pushClientBgUtils = typeof require === 'function'
  ? require('./background-utils')
  : globalThis.TaboxBackgroundUtils;
const { getAuthToken: pushClientGetAuthToken } = pushClientBgUtils;

const pushClientProConfig = typeof require === 'function'
  ? require('./pro-config')
  : { PRO_API_BASE, PUSH_VAPID_PUBLIC_KEY };
const { PRO_API_BASE: PUSH_API_BASE, PUSH_VAPID_PUBLIC_KEY: PUSH_VAPID_KEY } = pushClientProConfig;

const PUSH_STATE_KEY = 'push_subscription_state';
const PUSH_REREGISTER_INTERVAL_MS = 24 * 60 * 60 * 1000;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getPushState() {
  const stored = await browser.storage.local.get(PUSH_STATE_KEY);
  return stored[PUSH_STATE_KEY] || null;
}

async function isPushHealthy() {
  const state = await getPushState();
  return state?.healthy === true;
}

async function pushApiFetch(method, bodyObj) {
  const token = await pushClientGetAuthToken();
  return fetch(`${PUSH_API_BASE}/push/subscribe`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
}

// Explicit per-terminal-path writes (rather than a single `finally`) so that:
//  - signing-out short-circuits WITHOUT touching stored state;
//  - a fresh, healthy state short-circuits true WITHOUT rewriting state;
//  - every other terminal path (success or failure) writes state exactly once.
async function ensurePushSubscription({ force = false } = {}) {
  const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
  if (!googleRefreshToken) return false;

  const prev = await getPushState();
  if (!force && prev?.healthy &&
      Date.now() - (prev.lastRegisteredAt || 0) < PUSH_REREGISTER_INTERVAL_MS) {
    return true;
  }

  try {
    if (!self.registration?.pushManager) throw new Error('push_unsupported');
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: false,
      applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_KEY),
    });
    const { endpoint, keys } = sub.toJSON();
    const res = await pushApiFetch('POST', { endpoint, keys });
    if (!res.ok) throw new Error(`push_register_failed_${res.status}`);
    const state = { endpoint, healthy: true, lastRegisteredAt: Date.now() };
    await browser.storage.local.set({ [PUSH_STATE_KEY]: state });
    return true;
  } catch (error) {
    const state = { healthy: false, lastRegisteredAt: Date.now(), error: String(error?.message || error) };
    await browser.storage.local.set({ [PUSH_STATE_KEY]: state });
    return false;
  }
}

async function teardownPushSubscription() {
  try {
    const state = await getPushState();
    const sub = await self.registration?.pushManager?.getSubscription?.();
    if (sub) await sub.unsubscribe();
    const endpoint = state?.endpoint || sub?.endpoint;
    if (endpoint) await pushApiFetch('DELETE', { endpoint });
  } catch (error) {
    console.error('push teardown failed:', error);
  } finally {
    await browser.storage.local.remove(PUSH_STATE_KEY);
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    ensurePushSubscription,
    teardownPushSubscription,
    isPushHealthy,
    PUSH_STATE_KEY,
    urlBase64ToUint8Array,
  };
}
