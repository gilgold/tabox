import { browser } from '../../static/globals';
import { unwrapDeferredUrl } from './urlUtils';

export const DEFAULT_BROWSER_SESSION_RESULTS = browser.sessions?.MAX_SESSION_RESULTS ?? 25;

export function normalizeBrowserSessionTimestamp(lastModified) {
    if (typeof lastModified !== 'number' || !Number.isFinite(lastModified)) {
        return Date.now();
    }

    return lastModified < 1e12
        ? Math.round(lastModified * 1000)
        : Math.round(lastModified);
}

function sanitizeSessionKeyPart(value, fallback) {
    return (value ?? fallback ?? 'unknown').toString().replace(/[^a-zA-Z0-9_-]/g, '-');
}

function buildNativeSessionEntryKey(type, sessionId, timestamp, fallbackIndex = 0) {
    if (sessionId) {
        return `${type}:${sessionId}`;
    }

    return `${type}:fallback-${sanitizeSessionKeyPart(timestamp, Date.now())}-${fallbackIndex}`;
}

function buildCollectionUid(sessionEntryKey) {
    return `browser-session-${sanitizeSessionKeyPart(sessionEntryKey, 'entry')}`;
}

function normalizeBrowserSessionTab(tab, sessionEntryKey, index = 0) {
    const tabKeyPart = sanitizeSessionKeyPart(tab?.sessionId ?? tab?.id, index);

    return {
        uid: `${buildCollectionUid(sessionEntryKey)}-tab-${tabKeyPart}`,
        title: tab?.title || tab?.pendingUrl || tab?.url || 'Untitled tab',
        // Resolve any deferred-loading wrapper so captured sessions store the real URL.
        url: unwrapDeferredUrl(tab?.url || tab?.pendingUrl || ''),
        favIconUrl: tab?.favIconUrl || '',
        pinned: tab?.pinned === true,
        active: tab?.active === true,
        muted: tab?.mutedInfo?.muted === true,
        groupId: typeof tab?.groupId === 'number' ? tab.groupId : -1,
        index: typeof tab?.index === 'number' ? tab.index : index,
        wasIncognito: tab?.incognito === true,
        windowId: tab?.windowId ?? null,
    };
}

function buildNormalizedCollection({
    sessionId,
    sessionEntryKey,
    timestamp,
    sourceType,
    name,
    tabs,
}) {
    return {
        uid: buildCollectionUid(sessionEntryKey),
        name,
        tabs,
        chromeGroups: [],
        createdOn: timestamp,
        lastUpdated: timestamp,
        sessionId,
        sessionEntryKey,
        sourceType,
    };
}

export function normalizeBrowserSessionEntry(entry, index = 0) {
    const timestamp = normalizeBrowserSessionTimestamp(entry?.lastModified);

    if (entry?.window) {
        const windowSessionId = entry.window.sessionId ?? null;
        const sessionEntryKey = buildNativeSessionEntryKey('window', windowSessionId, timestamp, index);
        const tabs = (entry.window.tabs || []).map((tab, tabIndex) => (
            normalizeBrowserSessionTab(tab, sessionEntryKey, tabIndex)
        ));
        const isSingleTabWindow = tabs.length === 1;
        const normalizedSourceType = isSingleTabWindow ? 'tab' : 'window';
        const normalizedName = isSingleTabWindow
            ? tabs[0]?.title || 'Recently closed tab'
            : 'Recently closed window';

        return {
            timestamp,
            sessionId: windowSessionId,
            sessionEntryKey,
            sourceType: normalizedSourceType,
            collections: [
                buildNormalizedCollection({
                    sessionId: windowSessionId,
                    sessionEntryKey,
                    timestamp,
                    sourceType: normalizedSourceType,
                    name: normalizedName,
                    tabs,
                }),
            ],
        };
    }

    if (entry?.tab) {
        const tabSessionId = entry.tab.sessionId ?? null;
        const sessionEntryKey = buildNativeSessionEntryKey('tab', tabSessionId, timestamp, index);

        return {
            timestamp,
            sessionId: tabSessionId,
            sessionEntryKey,
            sourceType: 'tab',
            collections: [
                buildNormalizedCollection({
                    sessionId: tabSessionId,
                    sessionEntryKey,
                    timestamp,
                    sourceType: 'tab',
                    name: entry.tab.title || 'Recently closed tab',
                    tabs: [normalizeBrowserSessionTab(entry.tab, sessionEntryKey, 0)],
                }),
            ],
        };
    }

    return null;
}

export function getBrowserSessionEntryKey(entryOrCollection, fallbackTimestamp = null) {
    if (!entryOrCollection) {
        return null;
    }

    if (typeof entryOrCollection === 'string') {
        return entryOrCollection;
    }

    if (entryOrCollection.sessionEntryKey) {
        return entryOrCollection.sessionEntryKey;
    }

    if (entryOrCollection.collections?.[0]?.sessionEntryKey) {
        return entryOrCollection.collections[0].sessionEntryKey;
    }

    const collection = entryOrCollection.collections?.[0] || entryOrCollection;
    const timestamp = fallbackTimestamp ?? entryOrCollection.timestamp;

    if (collection?.uid && timestamp !== null && timestamp !== undefined) {
        return `${timestamp}::${collection.uid}`;
    }

    return collection?.uid || null;
}

function getSessionIdFromEntry(entryOrSessionId) {
    if (!entryOrSessionId) {
        return null;
    }

    if (typeof entryOrSessionId === 'string') {
        if (entryOrSessionId.startsWith('window:') || entryOrSessionId.startsWith('tab:')) {
            return entryOrSessionId.split(':').slice(1).join(':') || null;
        }

        return entryOrSessionId;
    }

    if (entryOrSessionId.sessionId) {
        return entryOrSessionId.sessionId;
    }

    if (entryOrSessionId.collections?.[0]?.sessionId) {
        return entryOrSessionId.collections[0].sessionId;
    }

    const sessionEntryKey = getBrowserSessionEntryKey(entryOrSessionId);
    if (sessionEntryKey?.startsWith('window:') || sessionEntryKey?.startsWith('tab:')) {
        return sessionEntryKey.split(':').slice(1).join(':') || null;
    }

    return null;
}

export async function loadBrowserSessions({ maxResults } = {}) {
    if (!browser.sessions?.getRecentlyClosed) {
        return [];
    }

    try {
        const filter = {};
        if (typeof maxResults === 'number' && Number.isFinite(maxResults)) {
            filter.maxResults = Math.min(Math.max(1, maxResults), DEFAULT_BROWSER_SESSION_RESULTS);
        }

        const entries = Object.keys(filter).length > 0
            ? await browser.sessions.getRecentlyClosed(filter)
            : await browser.sessions.getRecentlyClosed();

        return (entries || []).map((entry, index) => normalizeBrowserSessionEntry(entry, index)).filter(Boolean);
    } catch (error) {
        console.error('Failed to load browser sessions:', error);
        return [];
    }
}

export function subscribeToBrowserSessions(callback) {
    if (!browser.sessions?.onChanged?.addListener) {
        return () => {};
    }

    const listener = () => {
        Promise.resolve(callback?.()).catch((error) => {
            console.error('Failed to refresh browser sessions:', error);
        });
    };

    browser.sessions.onChanged.addListener(listener);

    return () => {
        browser.sessions?.onChanged?.removeListener?.(listener);
    };
}

export async function restoreBrowserSession(entryOrSessionId) {
    if (!browser.sessions?.restore) {
        throw new Error('Browser sessions API is unavailable');
    }

    const sessionId = getSessionIdFromEntry(entryOrSessionId);
    if (!sessionId) {
        throw new Error('No browser session id was found');
    }

    return browser.sessions.restore(sessionId);
}

export function getBrowserSessionCount(groups) {
    return (groups || []).reduce((sum, group) => sum + (group.collections?.length || 0), 0);
}
