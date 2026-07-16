/**
 * Premium Entitlement Cache Freshness and Grace Logic
 * Provides utilities for checking if cached entitlement is still valid
 * and whether it needs to be refreshed from the server.
 */

export const PREMIUM_STORAGE_KEY = 'premiumEntitlement';
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

/**
 * Check if cached entitlement is still honored.
 * Returns true if the cache is within the refresh window + offline grace period.
 * Returns false if null, not entitled, missing/invalid refreshedAt, or grace expired.
 *
 * @param {Object|null} cached - Cached entitlement record
 * @param {boolean} cached.entitled - Whether user is entitled
 * @param {string} cached.refreshedAt - ISO timestamp of last refresh
 * @param {number} nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns {boolean}
 */
export function isEntitled(cached, nowMs = Date.now()) {
    if (!cached || !cached.entitled || !cached.refreshedAt) return false;
    const refreshedAt = Date.parse(cached.refreshedAt);
    if (Number.isNaN(refreshedAt)) return false;
    return nowMs <= refreshedAt + REFRESH_INTERVAL_MS + OFFLINE_GRACE_MS;
}

/**
 * Check if cached entitlement should be refreshed.
 * Returns true if cache is null, missing/invalid refreshedAt, or older than refresh interval.
 * Returns false if cache is fresh enough.
 *
 * @param {Object|null} cached - Cached entitlement record
 * @param {string} cached.refreshedAt - ISO timestamp of last refresh
 * @param {number} nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns {boolean}
 */
export function isStale(cached, nowMs = Date.now()) {
    if (!cached || !cached.refreshedAt) return true;
    const refreshedAt = Date.parse(cached.refreshedAt);
    if (Number.isNaN(refreshedAt)) return true;
    return nowMs > refreshedAt + REFRESH_INTERVAL_MS;
}
