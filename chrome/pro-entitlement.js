/* eslint-disable no-undef */
// Tabox Pro entitlement cache. Loaded via importScripts in background.js after
// pro-config.js (PRO_API_BASE, PRO_CHECKOUT_URL) and background-utils.js (getAuthToken).

const PRO_ENTITLEMENT_KEY = 'premiumEntitlement';
const PRO_CHECKOUT_PENDING_KEY = 'proCheckoutPendingUntil';
const PRO_ENTITLEMENT_ALARM = 'pro-entitlement-refresh';
const PRO_CHECKOUT_POLL_ALARM = 'pro-checkout-poll';
const PRO_CHECKOUT_PENDING_MS = 30 * 60 * 1000;

async function refreshProEntitlement() {
  const { googleRefreshToken } = await browser.storage.local.get('googleRefreshToken');
  if (!googleRefreshToken) return null;
  let accessToken;
  try {
    accessToken = await getAuthToken();
  } catch {
    return null;
  }
  if (!accessToken) return null;
  let response;
  try {
    response = await fetch(`${PRO_API_BASE}/entitlement`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const data = await response.json();
  const record = { ...data, refreshedAt: new Date().toISOString() };
  await browser.storage.local.set({ [PRO_ENTITLEMENT_KEY]: record });
  return record;
}

async function openProCheckout() {
  const { googleUser } = await browser.storage.local.get('googleUser');
  if (!googleUser || !googleUser.permissionId) return false;
  const params = `uid=${encodeURIComponent(googleUser.permissionId)}&email=${encodeURIComponent(googleUser.emailAddress || '')}`;
  await browser.tabs.create({ url: `${PRO_CHECKOUT_URL}?${params}` });
  await browser.storage.local.set({ [PRO_CHECKOUT_PENDING_KEY]: Date.now() + PRO_CHECKOUT_PENDING_MS });
  await browser.alarms.create(PRO_CHECKOUT_POLL_ALARM, { periodInMinutes: 1 });
  return true;
}

async function handleProAlarm(alarmName) {
  if (alarmName === PRO_ENTITLEMENT_ALARM) {
    await refreshProEntitlement();
    return true;
  }
  if (alarmName === PRO_CHECKOUT_POLL_ALARM) {
    const record = await refreshProEntitlement();
    const { [PRO_CHECKOUT_PENDING_KEY]: pendingUntil } = await browser.storage.local.get(PRO_CHECKOUT_PENDING_KEY);
    if ((record && record.entitled) || !pendingUntil || Date.now() > pendingUntil) {
      await browser.alarms.clear(PRO_CHECKOUT_POLL_ALARM);
      await browser.storage.local.remove(PRO_CHECKOUT_PENDING_KEY);
    }
    return true;
  }
  return false;
}

async function ensureProEntitlementAlarm() {
  const alarms = await browser.alarms.getAll();
  if (!alarms.some((a) => a.name === PRO_ENTITLEMENT_ALARM)) {
    await browser.alarms.create(PRO_ENTITLEMENT_ALARM, { periodInMinutes: 24 * 60 });
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    refreshProEntitlement,
    openProCheckout,
    handleProAlarm,
    ensureProEntitlementAlarm,
    PRO_ENTITLEMENT_ALARM,
    PRO_CHECKOUT_POLL_ALARM,
  };
}
