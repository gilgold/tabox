/** @jest-environment jsdom */
import { browser } from '../static/globals';

// We import the module under test after setting up browser mocks
let captureWindowSnapshot;

const FULLPAGE_URL = 'chrome-extension://ext-id/fullpage.html';

const mockTabs = [
    { id: 1, url: 'https://a.com', title: 'A', groupId: 10 },
    { id: 2, url: 'https://b.com', title: 'B', groupId: 10 },
    { id: 3, url: 'https://c.com', title: 'C', groupId: -1 },
    { id: 4, url: FULLPAGE_URL, title: 'Tabox', groupId: -1 },
];

const mockGroups = [
    { id: 10, title: 'Work', color: 'blue', windowId: 42 },
    { id: 20, title: 'Other', color: 'red', windowId: 42 },
];

beforeEach(() => {
    browser.runtime.getURL = jest.fn().mockReturnValue(FULLPAGE_URL);
    browser.tabs = {
        query: jest.fn().mockResolvedValue(mockTabs),
    };
    browser.tabGroups = {
        query: jest.fn().mockResolvedValue(mockGroups),
    };
    jest.resetModules();
});

const load = async () => {
    const mod = await import('../app/ai/captureWindowSnapshot');
    captureWindowSnapshot = mod.captureWindowSnapshot;
};

test('returns all non-fullpage tabs including grouped ones', async () => {
    await load();
    const result = await captureWindowSnapshot(42);
    expect(result.tabs).toHaveLength(3); // excludes fullpage tab
    expect(result.tabs.map((t) => t.id)).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(result.tabs.find((t) => t.url === FULLPAGE_URL)).toBeUndefined();
});

test('preserves groupId on grouped tabs', async () => {
    await load();
    const result = await captureWindowSnapshot(42);
    const grouped = result.tabs.filter((t) => t.groupId === 10);
    expect(grouped).toHaveLength(2);
});

test('includes only groups referenced by the returned tabs', async () => {
    await load();
    const result = await captureWindowSnapshot(42);
    // Only group 10 is referenced; group 20 should be filtered out
    expect(result.chromeGroups).toHaveLength(1);
    expect(result.chromeGroups[0].id).toBe(10);
});

test('filters fullpage tab out before querying groups', async () => {
    await load();
    await captureWindowSnapshot(42);
    expect(browser.tabs.query).toHaveBeenCalledWith({ windowId: 42 });
});

test('tolerates missing tabGroups API and returns empty chromeGroups', async () => {
    browser.tabGroups = undefined;
    await load();
    const result = await captureWindowSnapshot(42);
    expect(result.tabs).toHaveLength(3);
    expect(result.chromeGroups).toEqual([]);
});

test('tolerates tabGroups.query throwing and returns empty chromeGroups', async () => {
    browser.tabGroups = { query: jest.fn().mockRejectedValue(new Error('no permission')) };
    await load();
    const result = await captureWindowSnapshot(42);
    expect(result.tabs).toHaveLength(3);
    expect(result.chromeGroups).toEqual([]);
});

test('returns empty chromeGroups when no tab is grouped', async () => {
    browser.tabs.query = jest.fn().mockResolvedValue([
        { id: 5, url: 'https://d.com', title: 'D', groupId: -1 },
    ]);
    await load();
    const result = await captureWindowSnapshot(42);
    expect(result.chromeGroups).toEqual([]);
});
