import { browser } from '../../static/globals';

export async function openOrFocusFullPageInCurrentWindow() {
    const fullPageUrl = browser.runtime.getURL('fullpage.html');
    const existingTabs = await browser.tabs.query({
        currentWindow: true,
        url: fullPageUrl,
    });
    const existingTab = existingTabs[0];

    if (existingTab?.id != null) {
        await browser.tabs.update(existingTab.id, { active: true });
        return existingTab;
    }

    return browser.tabs.create({ url: fullPageUrl });
}
