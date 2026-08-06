import {
    flattenWindows,
    scoreTabMatch,
    filterTabEntries,
    initialSelectionIndex,
    loadTabEntries,
    RESULT_CAP,
} from '../app/utils/tabSwitcherUtils';

const win = (id, tabs, { incognito = false } = {}) => ({ id, incognito, tabs });
const tab = (id, title, url, { lastAccessed = 0, active = false, pinned = false, muted = false } = {}) => ({
    id, title, url, lastAccessed, active, pinned,
    favIconUrl: `https://example.com/${id}.ico`,
    mutedInfo: { muted },
});

describe('flattenWindows', () => {
    test('flattens windows into MRU-sorted entries with window labels', () => {
        const windows = [
            win(10, [tab(1, 'Old tab', 'https://a.com', { lastAccessed: 100 })]),
            win(20, [
                tab(2, 'New tab', 'https://b.com', { lastAccessed: 300, active: true }),
                tab(3, 'Mid tab', 'https://c.com', { lastAccessed: 200 }),
            ]),
        ];
        const entries = flattenWindows(windows, 20);
        expect(entries.map(e => e.tabId)).toEqual([2, 3, 1]);
        expect(entries[0]).toMatchObject({
            tabId: 2, windowId: 20, title: 'New tab', url: 'https://b.com',
            active: true, isCurrentWindow: true, windowLabel: 'This window',
        });
        expect(entries[2].windowLabel).toBe('Window 1');
    });

    test('marks incognito entries and copies tab flags', () => {
        const windows = [win(10, [tab(1, 'Secret', 'https://s.com', { pinned: true, muted: true })], { incognito: true })];
        const entries = flattenWindows(windows, 99);
        expect(entries[0]).toMatchObject({ incognito: true, pinned: true, muted: true, isCurrentWindow: false });
    });

    test('falls back to url for missing titles and 0 for missing lastAccessed', () => {
        const windows = [win(10, [{ id: 1, url: 'https://only-url.com' }])];
        const entries = flattenWindows(windows, 10);
        expect(entries[0].title).toBe('https://only-url.com');
        expect(entries[0].lastAccessed).toBe(0);
    });
});

describe('scoreTabMatch', () => {
    const entry = { title: 'GitHub - tabox repo', url: 'https://github.com/gilgold/tabox' };
    test('ranks title prefix > title contains > url contains > no match', () => {
        expect(scoreTabMatch(entry, 'github')).toBeGreaterThan(scoreTabMatch(entry, 'tabox repo'));
        expect(scoreTabMatch(entry, 'tabox repo')).toBeGreaterThan(scoreTabMatch(entry, 'gilgold'));
        expect(scoreTabMatch(entry, 'zzz')).toBe(0);
    });
    test('is case-insensitive', () => {
        expect(scoreTabMatch(entry, 'GITHUB')).toBe(scoreTabMatch(entry, 'github'));
    });
});

describe('filterTabEntries', () => {
    const entries = [
        { title: 'Apple news', url: 'https://news.com', lastAccessed: 1 },
        { title: 'Banana docs', url: 'https://apple.dev/banana', lastAccessed: 2 },
        { title: 'apple store', url: 'https://store.com', lastAccessed: 3 },
    ];
    test('empty query returns entries unchanged (already MRU)', () => {
        expect(filterTabEntries(entries, '')).toBe(entries);
        expect(filterTabEntries(entries, '   ')).toBe(entries);
    });
    test('filters to matches, sorted by score then recency', () => {
        const result = filterTabEntries(entries, 'apple');
        // title-prefix matches first (recency breaks the tie between the two), url match last
        expect(result.map(e => e.title)).toEqual(['apple store', 'Apple news', 'Banana docs']);
    });
    test('non-matching query returns empty array', () => {
        expect(filterTabEntries(entries, 'zebra')).toEqual([]);
    });
});

describe('initialSelectionIndex', () => {
    test('skips row 0 when it is the active tab of the current window', () => {
        expect(initialSelectionIndex([
            { active: true, isCurrentWindow: true },
            { active: false, isCurrentWindow: true },
        ])).toBe(1);
    });
    test('selects row 0 otherwise', () => {
        expect(initialSelectionIndex([{ active: true, isCurrentWindow: false }, {}])).toBe(0);
        expect(initialSelectionIndex([{ active: false, isCurrentWindow: true }])).toBe(0);
    });
    test('handles a single-entry list', () => {
        expect(initialSelectionIndex([{ active: true, isCurrentWindow: true }])).toBe(0);
    });
});

describe('loadTabEntries', () => {
    test('queries all normal windows and the current window id', async () => {
        browser.windows.getAll.mockResolvedValue([win(10, [tab(1, 'A', 'https://a.com', { lastAccessed: 5 })])]);
        browser.windows.getCurrent.mockResolvedValue({ id: 10 });
        const entries = await loadTabEntries();
        expect(browser.windows.getAll).toHaveBeenCalledWith({ populate: true, windowTypes: ['normal'] });
        expect(entries[0].isCurrentWindow).toBe(true);
    });
    test('survives getCurrent failure (no window labeled current)', async () => {
        browser.windows.getAll.mockResolvedValue([win(10, [tab(1, 'A', 'https://a.com')])]);
        browser.windows.getCurrent.mockRejectedValue(new Error('no window'));
        const entries = await loadTabEntries();
        expect(entries[0].isCurrentWindow).toBe(false);
        expect(entries[0].windowLabel).toBe('Window 1');
    });
});

test('RESULT_CAP is a sane render limit', () => {
    expect(RESULT_CAP).toBe(50);
});
