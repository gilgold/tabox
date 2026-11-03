import { browser } from '../../static/globals';

// Capability checks for browsers with a reduced tabs model — today that is
// Firefox for Android, which has one tab strip and no windows, tab groups,
// sessions, commands or context menus APIs. Detect by capability, never by
// user agent, so desktop Firefox and Chromium keep every feature.

// No windows API: every tab lives in a single (implicit) window, and each
// tab reports its own windowId, so per-window logic (save "this window",
// open in a new window, current-windows view, tab switcher, auto-update
// tracking) cannot work.
export const isSingleWindowBrowser = () => !browser.windows;

export const hasTabGroups = () => !!browser.tabGroups;

export const hasRecentlyClosed = () => typeof browser.sessions?.getRecentlyClosed === 'function';

// Firefox for Android never sets Tab.favIconUrl; fall back to Google's
// favicon service so saved tabs still get an icon.
export function faviconServiceUrl(url) {
    try {
        const { hostname, protocol } = new URL(url);
        if (hostname && (protocol === 'http:' || protocol === 'https:')) {
            return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
        }
    } catch {
        // Malformed URL — no icon.
    }
    return '';
}

export function withFaviconFallback(tab) {
    if (tab.favIconUrl) return tab;
    const favIconUrl = faviconServiceUrl(tab.url);
    return favIconUrl ? { ...tab, favIconUrl } : tab;
}

// Registry entries (command palette, settings, AI tools) declare what they
// need via `requires`; unsupported ones are hidden rather than left to fail.
const CAPABILITY_CHECKS = {
    windows: () => !isSingleWindowBrowser(),
    autoUpdateRecovery: () => !!(browser.windows?.getAll && browser.storage.session?.get && browser.storage.session?.set && browser.alarms?.create && browser.alarms?.clear),
    tabGroups: hasTabGroups,
    recentlyClosed: hasRecentlyClosed,
    // The toolbar popup: Firefox for Android always opens the full page
    // instead (chrome/background.js toolbarAlwaysOpensFullPage).
    popup: () => !isSingleWindowBrowser(),
};

export function isSupported(requires) {
    if (!requires) return true;
    return [].concat(requires).every((req) => CAPABILITY_CHECKS[req]?.() ?? true);
}
