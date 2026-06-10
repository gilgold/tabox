import { browser } from '../../static/globals';

export const RESULT_CAP = 50;
export const FALLBACK_FAVICON = './images/favicon-fallback.png';

// Chrome never exposes user-assigned window names to extensions, so derive a
// label: ordinal in windows.getAll() order, "This window" for the window the
// switcher was opened from.
export function flattenWindows(windows, currentWindowId) {
    const entries = [];
    (windows || []).forEach((win, index) => {
        const isCurrentWindow = win.id === currentWindowId;
        const windowLabel = isCurrentWindow ? 'This window' : `Window ${index + 1}`;
        (win.tabs || []).forEach((tab) => {
            entries.push({
                tabId: tab.id,
                windowId: win.id,
                title: tab.title || tab.url || '',
                url: tab.url || '',
                favIconUrl: tab.favIconUrl || null,
                lastAccessed: tab.lastAccessed || 0,
                active: tab.active === true,
                pinned: tab.pinned === true,
                muted: tab.mutedInfo?.muted === true,
                incognito: win.incognito === true,
                isCurrentWindow,
                windowLabel,
            });
        });
    });
    return entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
}

export function scoreTabMatch(entry, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return 0;
    const title = (entry.title || '').toLowerCase();
    const url = (entry.url || '').toLowerCase();
    if (title.startsWith(q)) return 80;
    if (title.includes(q)) return 60;
    if (url.includes(q)) return 40;
    return 0;
}

export function filterTabEntries(entries, query) {
    const q = (query || '').trim();
    if (!q) return entries;
    return entries
        .map((entry) => ({ entry, score: scoreTabMatch(entry, q) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.lastAccessed - a.entry.lastAccessed)
        .map((item) => item.entry);
}

// Mirror OS Cmd+Tab: start on the "previous" tab, not the one you're on.
export function initialSelectionIndex(entries) {
    if (entries.length > 1 && entries[0].active && entries[0].isCurrentWindow) return 1;
    return 0;
}

export async function loadTabEntries() {
    const [windows, current] = await Promise.all([
        browser.windows.getAll({ populate: true, windowTypes: ['normal'] }),
        browser.windows.getCurrent().catch(() => null),
    ]);
    return flattenWindows(windows, current?.id ?? null);
}
