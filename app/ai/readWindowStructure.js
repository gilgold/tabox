// app/ai/readWindowStructure.js
import { browser } from '../../static/globals';

// Reads a window's structure for Smart Organize. Excludes pinned tabs and the
// Tabox full-page tab. "Ungrouped" means Chrome groupId === -1.
export async function readWindowStructure(windowId) {
    const fullPageUrl = browser.runtime.getURL('fullpage.html');
    const allTabs = await browser.tabs.query({ windowId });
    const eligible = allTabs.filter((t) => !t.pinned && t.url !== fullPageUrl);

    const ungroupedTabs = eligible
        .filter((t) => t.groupId === -1)
        .map((t) => ({ tabId: t.id, title: t.title, url: t.url }));

    let groups = [];
    try {
        groups = await browser.tabGroups.query({ windowId });
    } catch {
        groups = [];
    }
    const existingGroups = groups.map((g) => ({
        id: g.id,
        title: g.title,
        sampleTitles: allTabs.filter((t) => t.groupId === g.id).slice(0, 3).map((t) => t.title),
    }));

    return { ungroupedTabs, existingGroups, eligibleCount: ungroupedTabs.length };
}
