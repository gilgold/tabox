import { browser } from '../../static/globals';

// Full snapshot of a specific window for saving as a collection: every
// non-fullpage tab (with its groupId) plus the real tab-group objects.
// Mirrors getCurrentTabsAndGroups but scoped to an explicit windowId.
export async function captureWindowSnapshot(windowId) {
    const fullPageUrl = browser.runtime.getURL('fullpage.html');
    const tabs = (await browser.tabs.query({ windowId })).filter((t) => t.url !== fullPageUrl);

    let chromeGroups = [];
    if (browser.tabGroups) {
        try {
            const all = await browser.tabGroups.query({ windowId });
            const groupIds = [...new Set(tabs.filter(({ groupId }) => groupId > -1).map((t) => t.groupId))];
            chromeGroups = all.filter(({ id }) => groupIds.includes(id));
        } catch {
            chromeGroups = [];
        }
    }
    return { tabs, chromeGroups };
}
