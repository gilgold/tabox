import { browser } from '../../static/globals';
import { getMatchingTabs } from './searchUtils';

const createWindowUid = (windowId) => `current-window-${windowId}`;
const createTabUid = (windowId, tabId, fallbackIndex = 0) => `current-window-tab-${windowId}-${tabId ?? fallbackIndex}`;
const createGroupUid = (windowId, groupId, fallbackIndex = 0) => `current-window-group-${windowId}-${groupId ?? fallbackIndex}`;

const copyWindowForSnapshot = (window) => {
    const windowSnapshot = { ...window };
    delete windowSnapshot.tabs;
    return windowSnapshot;
};

const getCurrentWindowId = async () => {
    try {
        const currentWindow = await browser.windows.getCurrent({ windowTypes: ['normal'] });
        return currentWindow?.id ?? null;
    } catch {
        return null;
    }
};

const loadWindowGroups = async (windowId, tabs) => {
    if (!browser.tabGroups) {
        return [];
    }

    try {
        let groups = await browser.tabGroups.query({ windowId });
        const groupIds = [...new Set(
            (tabs || [])
                .filter((tab) => typeof tab.groupId === 'number' && tab.groupId > -1)
                .map((tab) => tab.groupId),
        )];

        if (groupIds.length === 0) {
            return [];
        }

        groups = groups.filter((group) => groupIds.includes(group.id));

        return groups.map((group, index) => ({
            ...group,
            uid: createGroupUid(windowId, group.id, index),
        }));
    } catch {
        return [];
    }
};

export async function loadCurrentWindowsSnapshots() {
    const [windows, currentWindowId] = await Promise.all([
        browser.windows.getAll({
            populate: true,
            windowTypes: ['normal'],
        }),
        getCurrentWindowId(),
    ]);

    const focusedWindowId = windows.find((window) => window.focused)?.id
        ?? currentWindowId
        ?? null;

    const snapshots = await Promise.all(windows.map(async (window, index) => {
        const tabs = (window.tabs || []).map((tab, tabIndex) => ({
            ...tab,
            uid: createTabUid(window.id, tab.id, tabIndex),
            groupUid: typeof tab.groupId === 'number' && tab.groupId > -1
                ? createGroupUid(window.id, tab.groupId)
                : undefined,
            wasIncognito: tab.incognito === true,
        }));
        const chromeGroups = await loadWindowGroups(window.id, tabs);
        const isCurrentWindow = window.id === focusedWindowId;

        return {
            uid: createWindowUid(window.id),
            windowId: window.id,
            name: isCurrentWindow ? 'Current Window' : `Window ${index + 1}`,
            tabs,
            chromeGroups,
            window: copyWindowForSnapshot(window),
            savedFromIncognito: window.incognito === true,
            incognitoTabCount: tabs.filter((tab) => tab.incognito === true).length,
            isFocused: window.focused === true,
            isCurrentWindow,
        };
    }));

    return snapshots;
}

export function getMatchingCurrentWindows(windows, search) {
    if (!search?.trim()) {
        return [];
    }

    return (windows || []).map((windowSnapshot) => {
        const matchingTabs = getMatchingTabs(windowSnapshot, search);

        return {
            windowSnapshot,
            matchingTabs,
        };
    }).filter((entry) => entry.matchingTabs.length > 0);
}

export function filterCurrentWindowsBySearch(windows, search) {
    if (!search?.trim()) {
        return windows;
    }

    return getMatchingCurrentWindows(windows, search).map((entry) => entry.windowSnapshot);
}
