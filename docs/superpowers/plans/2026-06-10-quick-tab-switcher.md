# Quick Tab Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An OS-Cmd+Tab-style switcher (Ctrl/Cmd+Shift+S or header button, popup + full page) that searches all open tabs across all windows, with highlighted matches, keyboard navigation, a live-tab context menu, and optional screenshot previews behind a runtime-requested `<all_urls>` permission.

**Architecture:** One `TabSwitcher` component portal-mounted from `App.js` (shared by both views, sized via CSS). Pure search/sort logic in `app/utils/tabSwitcherUtils.js`; list keyboard handling in a reusable `useListNavigation` hook. Background thumbnail capture lives in `chrome/thumbnail-capture.js` following the existing `importScripts` + `globalThis.TaboxX` + `module.exports`-for-Jest pattern, storing an LRU cache in `chrome.storage.session`.

**Tech Stack:** React 19, Jotai, plain CSS, Jest + RTL (unit), crxbox/Playwright (e2e). No TypeScript, no prop-types.

**Spec:** `docs/superpowers/specs/2026-06-10-quick-tab-switcher-design.md`

**Deviations from spec (discovered during planning):**
- Highlighting is ALREADY shared: `highlightText` lives in `app/utils/searchUtils.js` and takes a `matchClassName` — no extraction from CommandPalette needed. Reuse it directly.
- Hooks live flat in `app/` in this codebase (e.g. `app/useCollectionOperations.js`), so the hook goes to `app/useListNavigation.js`, not `app/hooks/`.
- Background module is named `chrome/thumbnail-capture.js` (kebab-case like `sync-merge.js`), copied to the build root by the existing `chrome/*.js` CopyPlugin rule.
- The spec says revocation "detaches listeners"; instead, listeners are attached synchronously at SW startup and stay attached, with the permission checked per capture. Reason: MV3 only wakes the service worker for listeners registered synchronously in the first event-loop turn — attaching after an awaited `permissions.contains()` would make capture events unreliable. Revocation still clears the cache; un-granted events are cheap no-ops.

**Conventions reminders:** 4-space indent in `app/`, 2-space in `chrome/` and `e2e/` (match each file's neighbors). Single quotes. Run commands from the repo root.

---

### Task 1: Pure tab-search utilities (`tabSwitcherUtils`)

**Files:**
- Create: `app/utils/tabSwitcherUtils.js`
- Test: `tests/tabSwitcherUtils.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/tabSwitcherUtils.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest --env=jsdom tests/tabSwitcherUtils.test.js`
Expected: FAIL — `Cannot find module '../app/utils/tabSwitcherUtils'`

- [ ] **Step 3: Implement the utilities**

```js
// app/utils/tabSwitcherUtils.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest --env=jsdom tests/tabSwitcherUtils.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app/utils/tabSwitcherUtils.js tests/tabSwitcherUtils.test.js
git commit -m "feat(switcher): tab entry flattening, MRU sort, and scored search utils"
```

---

### Task 2: `useListNavigation` hook

**Files:**
- Create: `app/useListNavigation.js`
- Test: `tests/useListNavigation.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/useListNavigation.test.js
import { renderHook, act } from '@testing-library/react';
import useListNavigation from '../app/useListNavigation';

const keyEvent = (key) => ({ key, preventDefault: jest.fn() });

describe('useListNavigation', () => {
    test('arrows move selection and wrap at both ends', () => {
        const { result } = renderHook(() => useListNavigation({ count: 3 }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(1);
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(0); // wrapped
        act(() => result.current.handleKeyDown(keyEvent('ArrowUp')));
        expect(result.current.selectedIndex).toBe(2); // wrapped back
    });

    test('Home and End jump to first and last', () => {
        const { result } = renderHook(() => useListNavigation({ count: 5 }));
        act(() => result.current.handleKeyDown(keyEvent('End')));
        expect(result.current.selectedIndex).toBe(4);
        act(() => result.current.handleKeyDown(keyEvent('Home')));
        expect(result.current.selectedIndex).toBe(0);
    });

    test('Enter calls onSelect with the selected index; Escape calls onClose', () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 3, onSelect, onClose }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        act(() => result.current.handleKeyDown(keyEvent('Enter')));
        expect(onSelect).toHaveBeenCalledWith(1);
        act(() => result.current.handleKeyDown(keyEvent('Escape')));
        expect(onClose).toHaveBeenCalled();
    });

    test('Escape still works with an empty list; other keys are ignored', () => {
        const onClose = jest.fn();
        const onSelect = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 0, onSelect, onClose }));
        act(() => result.current.handleKeyDown(keyEvent('Enter')));
        expect(onSelect).not.toHaveBeenCalled();
        act(() => result.current.handleKeyDown(keyEvent('Escape')));
        expect(onClose).toHaveBeenCalled();
    });

    test('selection resets to 0 when resetKey changes', () => {
        const { result, rerender } = renderHook(
            ({ resetKey }) => useListNavigation({ count: 3, resetKey }),
            { initialProps: { resetKey: '' } },
        );
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(1);
        rerender({ resetKey: 'abc' });
        expect(result.current.selectedIndex).toBe(0);
    });

    test('scrollTo is invoked on movement with the new index', () => {
        const scrollTo = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 3, scrollTo }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(scrollTo).toHaveBeenCalledWith(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest --env=jsdom tests/useListNavigation.test.js`
Expected: FAIL — `Cannot find module '../app/useListNavigation'`

- [ ] **Step 3: Implement the hook**

```js
// app/useListNavigation.js
import { useState, useCallback, useEffect } from 'react';

// Palette-style list keyboard navigation: wrapping arrows, Home/End,
// Enter selects, Escape closes. Selection resets when resetKey changes
// (pass the search query so new filters start at the top).
export default function useListNavigation({ count, onSelect, onClose, scrollTo, resetKey }) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        setSelectedIndex(0);
    }, [resetKey]);

    const move = useCallback((next) => {
        setSelectedIndex(next);
        scrollTo?.(next);
    }, [scrollTo]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose?.();
            return;
        }
        if (count === 0) return;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                move(selectedIndex < count - 1 ? selectedIndex + 1 : 0);
                break;
            case 'ArrowUp':
                e.preventDefault();
                move(selectedIndex > 0 ? selectedIndex - 1 : count - 1);
                break;
            case 'Home':
                e.preventDefault();
                move(0);
                break;
            case 'End':
                e.preventDefault();
                move(count - 1);
                break;
            case 'Enter':
                e.preventDefault();
                onSelect?.(selectedIndex);
                break;
        }
    }, [count, selectedIndex, move, onSelect, onClose]);

    return { selectedIndex, setSelectedIndex, handleKeyDown };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest --env=jsdom tests/useListNavigation.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/useListNavigation.js tests/useListNavigation.test.js
git commit -m "feat(switcher): reusable list keyboard navigation hook"
```

---

### Task 3: TabSwitcher component (list, search, context menu, preview pane)

**Files:**
- Create: `app/atoms/tabSwitcherState.js`
- Create: `app/TabSwitcher.js`
- Create: `app/TabSwitcher.css`
- Test: `tests/TabSwitcher.test.js`

- [ ] **Step 1: Create the atom** (too trivial to test in isolation; covered via component tests)

```js
// app/atoms/tabSwitcherState.js
import { atom } from 'jotai';

export const tabSwitcherOpenState = atom(false);
```

- [ ] **Step 2: Write the failing component tests**

Note the pattern: `browser` global comes from jest-webextension-mock (see `tests/AddNewTextbox.test.js`); `permissions` and `storage.session` aren't in the mock, so assign them in `beforeEach`. The harness opens the switcher by setting the atom on mount.

```js
// tests/TabSwitcher.test.js
import React, { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, useSetAtom } from 'jotai';
import TabSwitcher from '../app/TabSwitcher';
import { tabSwitcherOpenState } from '../app/atoms/tabSwitcherState';

jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
    showErrorToast: jest.fn(),
}));

function Harness() {
    const setOpen = useSetAtom(tabSwitcherOpenState);
    useEffect(() => { setOpen(true); }, [setOpen]);
    return <TabSwitcher />;
}

const renderOpenSwitcher = () => render(<Provider><Harness /></Provider>);

const seedWindows = (windows) => {
    browser.windows.getAll.mockResolvedValue(windows);
    browser.windows.getCurrent.mockResolvedValue({ id: 1 });
};

const twoWindowSeed = () => seedWindows([
    {
        id: 1, incognito: false, tabs: [
            { id: 11, title: 'Active Here', url: 'https://here.com', lastAccessed: 400, active: true, pinned: false, mutedInfo: { muted: false } },
            { id: 12, title: 'GitHub repo', url: 'https://github.com/x', lastAccessed: 300, active: false, pinned: false, mutedInfo: { muted: false } },
        ],
    },
    {
        id: 2, incognito: true, tabs: [
            { id: 21, title: 'Secret docs', url: 'https://secret.com', lastAccessed: 200, active: true, pinned: true, mutedInfo: { muted: true } },
        ],
    },
]);

describe('TabSwitcher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.permissions = {
            contains: jest.fn().mockResolvedValue(false),
            request: jest.fn().mockResolvedValue(true),
        };
        browser.storage.session = {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        browser.tabs.update.mockResolvedValue({});
        browser.tabs.remove.mockResolvedValue();
        browser.windows.update.mockResolvedValue({});
        browser.runtime.sendMessage.mockResolvedValue({});
    });

    test('renders all open tabs MRU-sorted with title, url, and window labels', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('Active Here');
        expect(rows[0]).toHaveTextContent('This window');
        expect(rows[2]).toHaveTextContent('Secret docs');
        expect(rows[2]).toHaveTextContent('Window 2');
        expect(rows[2]).toHaveTextContent('Incognito');
    });

    test('preselects the previous tab (row 1) when row 0 is the current active tab', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        await waitFor(() => expect(rows[1]).toHaveClass('selected'));
        expect(rows[0]).not.toHaveClass('selected');
    });

    test('typing filters the list and highlights matched text', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.change(screen.getByPlaceholderText('Jump to an open tab...'), { target: { value: 'github' } });
        const rows = await screen.findAllByTestId('tab-switcher-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelectorAll('.tab-switcher-match').length).toBeGreaterThan(0);
    });

    test('shows the empty state for a non-matching query', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.change(screen.getByPlaceholderText('Jump to an open tab...'), { target: { value: 'zzz-nope' } });
        expect(await screen.findByText('No matching tabs')).toBeInTheDocument();
    });

    test('Enter activates the selected tab and focuses its window when remote', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        const input = screen.getByPlaceholderText('Jump to an open tab...');
        fireEvent.change(input, { target: { value: 'secret' } });
        await screen.findAllByTestId('tab-switcher-row');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(21, { active: true }));
        expect(browser.windows.update).toHaveBeenCalledWith(2, { focused: true });
    });

    test('clicking a row activates that tab', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.click(rows[1]);
        await waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(12, { active: true }));
        // same window — no focus call needed
        expect(browser.windows.update).not.toHaveBeenCalled();
    });

    test('right-click opens the live-tab context menu with the full action set', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.contextMenu(rows[2]);
        expect(await screen.findByText('Switch to tab')).toBeInTheDocument();
        expect(screen.getByText('Copy URL')).toBeInTheDocument();
        expect(screen.getByText('Unpin tab')).toBeInTheDocument();   // seeded pinned: true
        expect(screen.getByText('Unmute tab')).toBeInTheDocument();  // seeded muted: true
        expect(screen.getByText('Move to new window')).toBeInTheDocument();
        expect(screen.getByText('Close tab')).toBeInTheDocument();
    });

    test('Close tab removes the tab and refreshes the list', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        const rows = await screen.findAllByTestId('tab-switcher-row');
        fireEvent.contextMenu(rows[2]);
        fireEvent.click(await screen.findByText('Close tab'));
        await waitFor(() => expect(browser.tabs.remove).toHaveBeenCalledWith(21));
        expect(browser.windows.getAll.mock.calls.length).toBeGreaterThanOrEqual(2); // initial load + refresh
    });

    test('preview pane shows the fallback card and Enable tab previews without permission', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        expect(await screen.findByText('Enable tab previews')).toBeInTheDocument();
        expect(document.querySelector('.tab-switcher-preview-card')).toBeInTheDocument();
    });

    test('Enable tab previews requests <all_urls> and asks background to prime the cache', async () => {
        twoWindowSeed();
        renderOpenSwitcher();
        fireEvent.click(await screen.findByText('Enable tab previews'));
        await waitFor(() => expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] }));
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'captureAllWindows' }));
    });

    test('shows the cached thumbnail for the selected tab when permission is granted', async () => {
        twoWindowSeed();
        browser.permissions.contains.mockResolvedValue(true);
        browser.storage.session.get.mockImplementation(async (key) => (
            key === 'thumb_12' ? { thumb_12: { dataUrl: 'data:image/jpeg;base64,xyz', capturedAt: 1 } } : {}
        ));
        renderOpenSwitcher();
        await screen.findAllByTestId('tab-switcher-row');
        // row 1 (tab 12) is preselected; preview is debounced 150ms
        await waitFor(() => {
            const img = document.querySelector('.tab-switcher-preview-shot');
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,xyz');
        }, { timeout: 2000 });
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn jest --env=jsdom tests/TabSwitcher.test.js`
Expected: FAIL — `Cannot find module '../app/TabSwitcher'`

- [ ] **Step 4: Implement the component**

```js
// app/TabSwitcher.js
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useAtom, useAtomValue } from 'jotai';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { highlightText } from './utils/searchUtils';
import {
    loadTabEntries,
    filterTabEntries,
    initialSelectionIndex,
    RESULT_CAP,
    FALLBACK_FAVICON,
} from './utils/tabSwitcherUtils';
import useListNavigation from './useListNavigation';
import ContextMenu from './ContextMenu';
import { copyToClipboard } from './utils/index';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { browser } from '../static/globals';
import {
    MdSearch,
    MdKeyboardReturn,
    MdTab,
    MdContentCopy,
    MdPushPin,
    MdVolumeOff,
    MdOpenInNew,
    MdClose,
    MdVisibilityOff,
} from 'react-icons/md';
import './TabSwitcher.css';

const ALL_URLS = { origins: ['<all_urls>'] };

function TabSwitcherRow({ entry, index, isSelected, onHover, onActivate, menuItems, itemRefs, query }) {
    const rowRef = useRef(null);

    return (
        <div
            ref={(el) => { rowRef.current = el; itemRefs.current[index] = el; }}
            className={`tab-switcher-row${isSelected ? ' selected' : ''}`}
            data-testid="tab-switcher-row"
            data-tab-id={entry.tabId}
            onClick={onActivate}
            onMouseEnter={onHover}
        >
            <img
                className="tab-switcher-favicon"
                src={entry.favIconUrl || FALLBACK_FAVICON}
                onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
                alt=""
            />
            <div className="tab-switcher-row-text">
                <span className="tab-switcher-row-title">
                    {highlightText(entry.title, query, 'tab-switcher-match') || entry.title}
                </span>
                <span className="tab-switcher-row-url">
                    {highlightText(entry.url, query, 'tab-switcher-match') || entry.url}
                </span>
            </div>
            <span className="tab-switcher-window-badge">
                {entry.incognito && (
                    <span className="tab-switcher-incognito-badge">
                        <MdVisibilityOff size={11} /> Incognito
                    </span>
                )}
                {entry.windowLabel}
            </span>
            <ContextMenu menuItems={menuItems} tooltip="Tab options" triggerRef={rowRef} />
            {isSelected && <MdKeyboardReturn size={14} className="tab-switcher-enter-hint" />}
        </div>
    );
}

function TabPreviewPane({ entry }) {
    const [hasPermission, setHasPermission] = useState(false);
    const [thumbnail, setThumbnail] = useState(null);
    const [debouncedEntry, setDebouncedEntry] = useState(entry);

    // Debounce selection changes so rapid arrowing never stutters the pane.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedEntry(entry), 150);
        return () => clearTimeout(t);
    }, [entry]);

    useEffect(() => {
        browser.permissions?.contains(ALL_URLS)
            .then((granted) => setHasPermission(!!granted))
            .catch(() => setHasPermission(false));
    }, []);

    useEffect(() => {
        let cancelled = false;
        setThumbnail(null);
        if (!hasPermission || !debouncedEntry) return undefined;
        const key = `thumb_${debouncedEntry.tabId}`;
        browser.storage.session.get(key)
            .then((data) => {
                if (!cancelled) setThumbnail(data?.[key]?.dataUrl || null);
            })
            .catch(() => { /* previews are best-effort */ });
        return () => { cancelled = true; };
    }, [debouncedEntry, hasPermission]);

    const requestPermission = useCallback(async () => {
        try {
            const granted = await browser.permissions.request(ALL_URLS);
            if (granted) {
                setHasPermission(true);
                browser.runtime.sendMessage({ type: 'captureAllWindows' }).catch(() => { /* noop */ });
            }
        } catch { /* dialog dismissed or no user gesture */ }
    }, []);

    if (!entry) return <div className="tab-switcher-preview empty" />;

    return (
        <div className="tab-switcher-preview">
            {thumbnail ? (
                <img className="tab-switcher-preview-shot" src={thumbnail} alt="Tab preview" />
            ) : (
                <div className="tab-switcher-preview-card">
                    <img
                        className="tab-switcher-preview-favicon"
                        src={entry.favIconUrl || FALLBACK_FAVICON}
                        onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
                        alt=""
                    />
                    <div className="tab-switcher-preview-title">{entry.title}</div>
                    <div className="tab-switcher-preview-url">{entry.url}</div>
                </div>
            )}
            <div className="tab-switcher-preview-meta">
                {entry.windowLabel}{entry.incognito ? ' · Incognito' : ''}
            </div>
            {!hasPermission && (
                <button className="tab-switcher-enable-previews" onClick={requestPermission}>
                    Enable tab previews
                </button>
            )}
        </div>
    );
}

function TabSwitcher() {
    const [isOpen, setIsOpen] = useAtom(tabSwitcherOpenState);
    const viewContext = useAtomValue(viewContextState);
    const [query, setQuery] = useState('');
    const [entries, setEntries] = useState([]);
    const inputRef = useRef(null);
    const itemRefs = useRef({});

    const results = useMemo(() => filterTabEntries(entries, query), [entries, query]);
    const visibleResults = useMemo(() => results.slice(0, RESULT_CAP), [results]);
    const hiddenCount = results.length - visibleResults.length;

    const close = useCallback(() => setIsOpen(false), [setIsOpen]);

    const refreshEntries = useCallback(async () => {
        try {
            setEntries(await loadTabEntries());
        } catch {
            setEntries([]);
        }
    }, []);

    const scrollSelectedIntoView = useCallback((index) => {
        requestAnimationFrame(() => {
            itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
        });
    }, []);

    const activateTab = useCallback(async (entry) => {
        if (!entry) return;
        try {
            await browser.tabs.update(entry.tabId, { active: true });
            if (!entry.isCurrentWindow) {
                await browser.windows.update(entry.windowId, { focused: true });
            }
            close();
            if (viewContext === 'popup') window.close();
        } catch {
            // The tab vanished while the switcher was open — drop the stale row.
            showErrorToast('That tab is no longer open');
            refreshEntries();
        }
    }, [close, viewContext, refreshEntries]);

    const { selectedIndex, setSelectedIndex, handleKeyDown } = useListNavigation({
        count: visibleResults.length,
        onSelect: (i) => activateTab(visibleResults[i]),
        onClose: close,
        scrollTo: scrollSelectedIntoView,
        resetKey: query,
    });

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        refreshEntries();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => inputRef.current?.focus());
        });
    }, [isOpen, refreshEntries]);

    // Once entries land for an empty query, preselect the "previous" tab.
    useEffect(() => {
        if (!isOpen || query !== '') return;
        setSelectedIndex(initialSelectionIndex(entries));
    }, [isOpen, entries, query, setSelectedIndex]);

    const buildMenuItems = useCallback((entry) => [
        { id: 'switch', text: 'Switch to tab', icon: <MdTab />, action: () => activateTab(entry) },
        {
            id: 'copy-url', text: 'Copy URL', icon: <MdContentCopy />,
            action: async () => {
                try {
                    await copyToClipboard(entry.url);
                    showSuccessToast('URL copied');
                } catch {
                    showErrorToast('Failed to copy URL');
                }
            },
        },
        {
            id: 'pin', text: entry.pinned ? 'Unpin tab' : 'Pin tab', icon: <MdPushPin />,
            action: async () => {
                try { await browser.tabs.update(entry.tabId, { pinned: !entry.pinned }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'mute', text: entry.muted ? 'Unmute tab' : 'Mute tab', icon: <MdVolumeOff />,
            action: async () => {
                try { await browser.tabs.update(entry.tabId, { muted: !entry.muted }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'move-new-window', text: 'Move to new window', icon: <MdOpenInNew />,
            action: async () => {
                try { await browser.windows.create({ tabId: entry.tabId }); } catch { /* noop */ }
                refreshEntries();
            },
        },
        {
            id: 'close', text: 'Close tab', icon: <MdClose />, className: 'danger',
            action: async () => {
                try { await browser.tabs.remove(entry.tabId); } catch { /* noop */ }
                refreshEntries();
            },
        },
    ], [activateTab, refreshEntries]);

    const handleOverlayClick = useCallback((e) => {
        if (e.target === e.currentTarget) close();
    }, [close]);

    if (!isOpen) return null;

    const selectedEntry = visibleResults[selectedIndex] || null;

    return ReactDOM.createPortal(
        <div className="tab-switcher-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={-1}>
            <div className={`tab-switcher-card ${viewContext === 'fullpage' ? 'fullpage' : 'popup'}`}>
                <div className="tab-switcher-main">
                    <div className="tab-switcher-input-row">
                        <MdSearch size={20} className="tab-switcher-search-icon" />
                        <input
                            ref={inputRef}
                            type="text"
                            className="tab-switcher-input"
                            placeholder="Jump to an open tab..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <kbd className="tab-switcher-esc-hint">Esc</kbd>
                    </div>
                    <div className="tab-switcher-results">
                        {visibleResults.length > 0 ? (
                            visibleResults.map((entry, i) => (
                                <TabSwitcherRow
                                    key={entry.tabId}
                                    entry={entry}
                                    index={i}
                                    isSelected={i === selectedIndex}
                                    onHover={() => setSelectedIndex(i)}
                                    onActivate={() => activateTab(entry)}
                                    menuItems={buildMenuItems(entry)}
                                    itemRefs={itemRefs}
                                    query={query}
                                />
                            ))
                        ) : (
                            <div className="tab-switcher-empty">No matching tabs</div>
                        )}
                        {hiddenCount > 0 && (
                            <div className="tab-switcher-more-hint">
                                {hiddenCount} more — keep typing to narrow down
                            </div>
                        )}
                    </div>
                    <div className="tab-switcher-footer">
                        <span className="tab-switcher-footer-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                        <span className="tab-switcher-footer-hint"><kbd>↵</kbd> switch</span>
                        <span className="tab-switcher-footer-hint"><kbd>esc</kbd> close</span>
                    </div>
                </div>
                <TabPreviewPane entry={selectedEntry} />
            </div>
        </div>,
        document.body
    );
}

export default TabSwitcher;
```

- [ ] **Step 5: Create the stylesheet**

```css
/* app/TabSwitcher.css */

/* ─── Overlay (matches CommandPalette's glass treatment) ─── */
.tab-switcher-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px) saturate(160%);
    -webkit-backdrop-filter: blur(6px) saturate(160%);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 10%;
    animation: tabSwitcherOverlayIn 0.12s ease-out;
}

[data-theme="dark"] .tab-switcher-overlay {
    background: rgba(0, 0, 0, 0.55);
}

@keyframes tabSwitcherOverlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

/* ─── Card ─── */
.tab-switcher-card {
    display: flex;
    background: linear-gradient(165deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.92) 100%);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 16px;
    box-shadow:
        0 24px 48px rgba(0, 0, 0, 0.18),
        0 8px 16px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    animation: tabSwitcherCardIn 0.12s ease-out;
}

[data-theme="dark"] .tab-switcher-card {
    background: linear-gradient(165deg, rgba(30, 34, 42, 0.96) 0%, rgba(24, 28, 36, 0.94) 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        0 24px 48px rgba(0, 0, 0, 0.45),
        0 8px 16px rgba(0, 0, 0, 0.25);
}

@keyframes tabSwitcherCardIn {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
}

/* Popup: column layout, preview docks below the list */
.tab-switcher-card.popup {
    flex-direction: column;
    width: min(620px, 94vw);
    max-height: min(520px, 86vh);
}

/* Full page: row layout, preview docks beside the list */
.tab-switcher-card.fullpage {
    flex-direction: row;
    width: min(860px, 90vw);
    max-height: min(520px, 70vh);
}

.tab-switcher-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

/* ─── Input ─── */
.tab-switcher-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--setting-row-hover-bg-color);
}

.tab-switcher-search-icon {
    color: var(--text-color);
    opacity: 0.5;
    flex-shrink: 0;
}

.tab-switcher-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-size: 15px;
    color: var(--text-color);
}

.tab-switcher-esc-hint,
.tab-switcher-footer kbd {
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 4px;
    border: 1px solid var(--setting-row-hover-bg-color);
    color: var(--text-color);
    opacity: 0.6;
    background: transparent;
}

/* ─── Results ─── */
.tab-switcher-results {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    min-height: 120px;
}

.tab-switcher-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
}

.tab-switcher-row.selected {
    background: var(--setting-row-hover-bg-color);
}

.tab-switcher-favicon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 3px;
}

.tab-switcher-row-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.tab-switcher-row-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tab-switcher-row-url {
    font-size: 11px;
    color: var(--text-color);
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tab-switcher-match {
    background: var(--primary-hover-bg);
    color: var(--primary-color);
    border-radius: 2px;
}

.tab-switcher-window-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-color);
    opacity: 0.6;
    white-space: nowrap;
}

.tab-switcher-incognito-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--setting-row-hover-bg-color);
    font-weight: 600;
}

/* The reusable ContextMenu trigger ("...") — only visible on hover/selection */
.tab-switcher-row .menu-icon {
    visibility: hidden;
    flex-shrink: 0;
    color: var(--text-color);
    opacity: 0.6;
    cursor: pointer;
}

.tab-switcher-row:hover .menu-icon,
.tab-switcher-row.selected .menu-icon {
    visibility: visible;
}

.tab-switcher-enter-hint {
    flex-shrink: 0;
    color: var(--text-color);
    opacity: 0.45;
}

.tab-switcher-empty,
.tab-switcher-more-hint {
    text-align: center;
    padding: 18px 12px;
    font-size: 12px;
    color: var(--text-color);
    opacity: 0.55;
}

.tab-switcher-more-hint {
    padding: 8px 12px;
}

/* ─── Footer ─── */
.tab-switcher-footer {
    display: flex;
    gap: 14px;
    padding: 8px 16px;
    border-top: 1px solid var(--setting-row-hover-bg-color);
    font-size: 11px;
    color: var(--text-color);
    opacity: 0.7;
}

.tab-switcher-footer-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

/* ─── Preview pane ─── */
.tab-switcher-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px;
    flex-shrink: 0;
}

.tab-switcher-card.fullpage .tab-switcher-preview {
    width: 280px;
    border-left: 1px solid var(--setting-row-hover-bg-color);
}

.tab-switcher-card.popup .tab-switcher-preview {
    border-top: 1px solid var(--setting-row-hover-bg-color);
    max-height: 190px;
}

.tab-switcher-preview-shot {
    max-width: 100%;
    max-height: 150px;
    border-radius: 8px;
    border: 1px solid var(--setting-row-hover-bg-color);
    object-fit: contain;
}

.tab-switcher-preview-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 8px;
}

.tab-switcher-preview-favicon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
}

.tab-switcher-preview-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tab-switcher-preview-url {
    font-size: 10px;
    color: var(--text-color);
    opacity: 0.55;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tab-switcher-preview-meta {
    font-size: 10px;
    color: var(--text-color);
    opacity: 0.6;
}

.tab-switcher-enable-previews {
    font-size: 11px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--primary-color);
    background: transparent;
    color: var(--primary-color);
    cursor: pointer;
}

.tab-switcher-enable-previews:hover {
    background: var(--primary-hover-bg);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn jest --env=jsdom tests/TabSwitcher.test.js`
Expected: PASS. If the context-menu tests fail on positioning effects, check that `fireEvent.contextMenu` targets the row element (the `triggerRef` host).

- [ ] **Step 7: Commit**

```bash
git add app/atoms/tabSwitcherState.js app/TabSwitcher.js app/TabSwitcher.css tests/TabSwitcher.test.js
git commit -m "feat(switcher): TabSwitcher palette with search, context menu, and preview pane"
```

---

### Task 4: Entry points — App.js shortcut + mount, header buttons

**Files:**
- Create: `app/TabSwitcherButton.js`
- Modify: `app/App.js` (imports ~line 10-13, atom hooks ~line 248, shortcut effect ~line 1823, render ~line 1980)
- Modify: `app/Header.js` (header-right, ~line 232)
- Modify: `app/fullpage/FPTopBar.js` (control strip, ~line 84)
- Test: `tests/TabSwitcherButton.test.js`

- [ ] **Step 1: Write the failing button test**

```js
// tests/TabSwitcherButton.test.js
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import TabSwitcherButton from '../app/TabSwitcherButton';
import { tabSwitcherOpenState } from '../app/atoms/tabSwitcherState';

test('clicking the button opens the tab switcher atom', () => {
    const store = createStore();
    render(
        <Provider store={store}>
            <TabSwitcherButton />
        </Provider>
    );
    const btn = screen.getByTestId('tab-switcher-button');
    expect(btn).toHaveAttribute('data-tooltip-content', expect.stringContaining('Quick tab switcher'));
    fireEvent.click(btn);
    expect(store.get(tabSwitcherOpenState)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest --env=jsdom tests/TabSwitcherButton.test.js`
Expected: FAIL — `Cannot find module '../app/TabSwitcherButton'`

- [ ] **Step 3: Implement the button**

```js
// app/TabSwitcherButton.js
import React from 'react';
import { useSetAtom } from 'jotai';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
import { MdSwapHoriz } from 'react-icons/md';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const SHORTCUT_HINT = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';

function TabSwitcherButton({ className = 'header-action-btn' }) {
    const setOpen = useSetAtom(tabSwitcherOpenState);
    return (
        <button
            className={className}
            onClick={() => setOpen(true)}
            data-testid="tab-switcher-button"
            data-tooltip-id="main-tooltip"
            data-tooltip-content={`Quick tab switcher (${SHORTCUT_HINT})`}
        >
            <MdSwapHoriz size={18} />
        </button>
    );
}

export default TabSwitcherButton;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest --env=jsdom tests/TabSwitcherButton.test.js`
Expected: PASS

- [ ] **Step 5: Wire into App.js**

Four edits, all in `app/App.js`:

(a) Add imports next to the CommandPalette import (line ~10-13):

```js
import TabSwitcher from './TabSwitcher';
import { tabSwitcherOpenState } from './atoms/tabSwitcherState';
```

(b) Add the atom setter next to `setCommandPaletteOpen` (line ~248):

```js
const setTabSwitcherOpen = useSetAtom(tabSwitcherOpenState);
```

(c) Replace the existing Cmd+K effect (lines 1823-1833) with one effect handling BOTH shortcuts — opening one palette closes the other so they never stack:

```js
// Command Palette (Cmd/Ctrl+K) and Tab Switcher (Cmd/Ctrl+Shift+S) shortcuts
useEffect(() => {
    const handleKeyDown = (e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'k') {
            e.preventDefault();
            setTabSwitcherOpen(false);
            setCommandPaletteOpen(prev => !prev);
        }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            setCommandPaletteOpen(false);
            setTabSwitcherOpen(prev => !prev);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
}, [setCommandPaletteOpen, setTabSwitcherOpen]);
```

(d) Mount the switcher next to the palette. Below `const commandPaletteEl = (...)` (line ~1980) add:

```js
const tabSwitcherEl = <TabSwitcher />;
```

Then find BOTH places `{commandPaletteEl}` appears in the JSX (one in the `isFullPage` return branch, one in the popup return branch) and add `{tabSwitcherEl}` directly after each.

- [ ] **Step 6: Add the button to both headers**

In `app/Header.js`: import the component and render it as the FIRST child of `<div className="header-right">` (line ~232), before the open-full-page button:

```js
import TabSwitcherButton from './TabSwitcherButton';
```
```jsx
<div className="header-right">
    <TabSwitcherButton />
    <button
        className="header-action-btn"
        ...
```

In `app/fullpage/FPTopBar.js`: import it and render as the FIRST child of `<div className="fp-control-strip">` (line ~85), followed by a separator:

```js
import TabSwitcherButton from '../TabSwitcherButton';
```
```jsx
<div className="fp-control-strip">
    <TabSwitcherButton />
    <div className="header-separator" />
    <SyncStatus onTriggerSync={triggerSync} />
    ...
```

(`header-action-btn` styles come from `Header.css`, already loaded in both views via the `Header` module import.)

- [ ] **Step 7: Run the full unit suite to catch regressions**

Run: `yarn test`
Expected: PASS (existing App/Header/FPTopBar tests still green; `App.commandPaletteOpen.test.js` exercises the area edited in (c))

- [ ] **Step 8: Build**

Run: `yarn prod`
Expected: webpack exits 0

- [ ] **Step 9: Commit**

```bash
git add app/TabSwitcherButton.js tests/TabSwitcherButton.test.js app/App.js app/Header.js app/fullpage/FPTopBar.js
git commit -m "feat(switcher): Ctrl/Cmd+Shift+S shortcut and header buttons in popup and full page"
```

---

### Task 5: Background thumbnail capture + manifest + message wiring

**Files:**
- Create: `chrome/thumbnail-capture.js`
- Modify: `chrome/manifest.json` (add `optional_host_permissions`)
- Modify: `chrome/background.js` (importScripts block line ~3-9; onMessage listener line ~1408)
- Test: `tests/thumbnailCapture.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/thumbnailCapture.test.js
const { createThumbnailCapture } = require('../chrome/thumbnail-capture.js');

const listenerSet = () => ({ addListener: jest.fn(), removeListener: jest.fn() });

function makeBrowser({ granted = true } = {}) {
    const sessionStore = {};
    return {
        _sessionStore: sessionStore,
        permissions: {
            contains: jest.fn().mockResolvedValue(granted),
            onAdded: listenerSet(),
            onRemoved: listenerSet(),
        },
        tabs: {
            onActivated: listenerSet(),
            onUpdated: listenerSet(),
            onRemoved: listenerSet(),
            query: jest.fn().mockResolvedValue([{ id: 7, active: true }]),
            captureVisibleTab: jest.fn().mockResolvedValue('data:image/jpeg;base64,RAW'),
        },
        windows: {
            onFocusChanged: listenerSet(),
            getAll: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        },
        storage: {
            session: {
                get: jest.fn(async (key) => (key in sessionStore ? { [key]: sessionStore[key] } : {})),
                set: jest.fn(async (items) => Object.assign(sessionStore, items)),
                remove: jest.fn(async (keys) => {
                    (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete sessionStore[k]);
                }),
            },
        },
    };
}

const identityDownscale = jest.fn(async (dataUrl) => `scaled:${dataUrl}`);

describe('createThumbnailCapture', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    test('init() attaches all capture listeners synchronously (MV3 wake requirement)', () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        // No awaits before these asserts — attachment must be synchronous.
        expect(browser.tabs.onActivated.addListener).toHaveBeenCalled();
        expect(browser.tabs.onUpdated.addListener).toHaveBeenCalled();
        expect(browser.windows.onFocusChanged.addListener).toHaveBeenCalled();
        expect(browser.tabs.onRemoved.addListener).toHaveBeenCalled();
        expect(browser.permissions.onRemoved.addListener).toHaveBeenCalled();
    });

    test('without the permission, capture events are no-ops (nothing captured or stored)', async () => {
        const browser = makeBrowser({ granted: false });
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        capture.scheduleCapture(1);
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('scheduleCapture debounces, captures the visible tab, downscales, and stores with LRU index', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        capture.scheduleCapture(1); // coalesced
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'jpeg', quality: 70 });
        expect(browser._sessionStore.thumb_7.dataUrl).toBe('scaled:data:image/jpeg;base64,RAW');
        expect(browser._sessionStore.thumb_index).toEqual([7]);
    });

    test('evicts the oldest thumbnail beyond the 100-entry cap', async () => {
        const browser = makeBrowser();
        // Pre-fill a full index: tab ids 1..100, id 100 is oldest (last).
        browser._sessionStore.thumb_index = Array.from({ length: 100 }, (_, i) => i + 1);
        browser._sessionStore.thumb_100 = { dataUrl: 'old', capturedAt: 0 };
        browser.tabs.query.mockResolvedValue([{ id: 999, active: true }]);
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        await jest.advanceTimersByTimeAsync(700);
        expect(browser._sessionStore.thumb_index).toHaveLength(100);
        expect(browser._sessionStore.thumb_index[0]).toBe(999);
        expect(browser._sessionStore.thumb_index).not.toContain(100);
        expect(browser._sessionStore.thumb_100).toBeUndefined();
    });

    test('capture failures (chrome:// pages, closed windows) are swallowed', async () => {
        const browser = makeBrowser();
        browser.tabs.captureVisibleTab.mockRejectedValue(new Error('Cannot access contents of the page'));
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.scheduleCapture(1);
        await expect(jest.advanceTimersByTimeAsync(700)).resolves.not.toThrow();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('tab removal prunes its thumbnail and index entry', async () => {
        const browser = makeBrowser();
        browser._sessionStore.thumb_index = [7, 8];
        browser._sessionStore.thumb_7 = { dataUrl: 'x', capturedAt: 0 };
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        const onRemoved = browser.tabs.onRemoved.addListener.mock.calls[0][0];
        await onRemoved(7);
        expect(browser._sessionStore.thumb_index).toEqual([8]);
        expect(browser._sessionStore.thumb_7).toBeUndefined();
    });

    test('permission revocation clears the cache', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        capture.init();
        browser._sessionStore.thumb_index = [7];
        browser._sessionStore.thumb_7 = { dataUrl: 'x', capturedAt: 0 };
        browser.permissions.contains.mockResolvedValue(false);
        const onPermRemoved = browser.permissions.onRemoved.addListener.mock.calls[0][0];
        await onPermRemoved();
        expect(browser._sessionStore.thumb_7).toBeUndefined();
        expect(browser._sessionStore.thumb_index).toBeUndefined();
    });

    test('captureAllWindows schedules a capture for every open window', async () => {
        const browser = makeBrowser();
        const capture = createThumbnailCapture(browser, { downscale: identityDownscale });
        await capture.captureAllWindows();
        await jest.advanceTimersByTimeAsync(700);
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(1, expect.anything());
        expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(2, expect.anything());
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest --env=jsdom tests/thumbnailCapture.test.js`
Expected: FAIL — `Cannot find module '../chrome/thumbnail-capture.js'`

- [ ] **Step 3: Implement the capture module**

2-space indent (chrome/ convention). The `downscale` option exists so Jest can avoid `OffscreenCanvas` (unavailable in jsdom).

```js
/* eslint-disable no-undef */
// Thumbnail capture pipeline for the quick tab switcher.
// Captures the visible tab of a window on activation/load/focus (debounced to
// respect captureVisibleTab's 2-calls-per-second quota), downscales to ~320px
// JPEG, and keeps an LRU-capped cache in chrome.storage.session — memory-only,
// never written to disk, which also keeps incognito captures off disk.
(function (global) {
  const THUMB_PREFIX = 'thumb_';
  const THUMB_INDEX_KEY = 'thumb_index';
  const MAX_THUMBS = 100;
  const CAPTURE_DEBOUNCE_MS = 600;
  const TARGET_WIDTH = 320;

  async function defaultDownscale(dataUrl) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      return dataUrl;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });
  }

  function createThumbnailCapture(browser, { downscale = defaultDownscale } = {}) {
    const debounceTimers = new Map();

    async function storeThumbnail(tabId, dataUrl) {
      const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
      let index = indexData?.[THUMB_INDEX_KEY] || [];
      index = [tabId, ...index.filter((id) => id !== tabId)];
      const evicted = index.slice(MAX_THUMBS);
      index = index.slice(0, MAX_THUMBS);
      await browser.storage.session.set({
        [THUMB_INDEX_KEY]: index,
        [`${THUMB_PREFIX}${tabId}`]: { dataUrl, capturedAt: Date.now() },
      });
      if (evicted.length > 0) {
        await browser.storage.session.remove(evicted.map((id) => `${THUMB_PREFIX}${id}`));
      }
    }

    async function hasPermission() {
      try {
        return await browser.permissions.contains({ origins: ['<all_urls>'] });
      } catch {
        return false;
      }
    }

    async function captureWindow(windowId) {
      try {
        if (!(await hasPermission())) return;
        const tabs = await browser.tabs.query({ active: true, windowId });
        const tab = tabs?.[0];
        if (!tab || tab.id === undefined) return;
        const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
        if (!dataUrl) return;
        await storeThumbnail(tab.id, await downscale(dataUrl));
      } catch {
        // chrome:// pages, store pages, closed windows, quota errors —
        // the switcher just falls back to the favicon card.
      }
    }

    function scheduleCapture(windowId) {
      if (windowId === undefined || windowId === null || windowId < 0) return;
      const existing = debounceTimers.get(windowId);
      if (existing) clearTimeout(existing);
      debounceTimers.set(windowId, setTimeout(() => {
        debounceTimers.delete(windowId);
        captureWindow(windowId);
      }, CAPTURE_DEBOUNCE_MS));
    }

    const onActivated = (activeInfo) => scheduleCapture(activeInfo.windowId);
    const onUpdated = (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab?.active) scheduleCapture(tab.windowId);
    };
    const onFocusChanged = (windowId) => scheduleCapture(windowId);
    const onTabRemoved = async (tabId) => {
      try {
        const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
        const index = (indexData?.[THUMB_INDEX_KEY] || []).filter((id) => id !== tabId);
        await browser.storage.session.set({ [THUMB_INDEX_KEY]: index });
        await browser.storage.session.remove(`${THUMB_PREFIX}${tabId}`);
      } catch { /* noop */ }
    };

    async function clearCache() {
      try {
        const indexData = await browser.storage.session.get(THUMB_INDEX_KEY);
        const index = indexData?.[THUMB_INDEX_KEY] || [];
        await browser.storage.session.remove([
          THUMB_INDEX_KEY,
          ...index.map((id) => `${THUMB_PREFIX}${id}`),
        ]);
      } catch { /* noop */ }
    }

    async function captureAllWindows() {
      try {
        const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
        windows.forEach((win) => scheduleCapture(win.id));
      } catch { /* noop */ }
    }

    // Synchronous on purpose: MV3 only wakes the service worker for listeners
    // registered in the first turn of the event loop. The permission is checked
    // per capture instead, so un-granted events are cheap no-ops.
    function init() {
      browser.tabs.onActivated.addListener(onActivated);
      browser.tabs.onUpdated.addListener(onUpdated);
      browser.windows.onFocusChanged.addListener(onFocusChanged);
      browser.tabs.onRemoved.addListener(onTabRemoved);
      browser.permissions.onRemoved.addListener(async () => {
        if (!(await hasPermission())) await clearCache();
      });
    }

    return { init, scheduleCapture, captureAllWindows, clearCache };
  }

  const api = { createThumbnailCapture };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TaboxThumbnails = api;
})(globalThis);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest --env=jsdom tests/thumbnailCapture.test.js`
Expected: PASS

- [ ] **Step 5: Manifest — optional host permission**

In `chrome/manifest.json`, after the `host_permissions` array (line ~64-67), add:

```json
"optional_host_permissions": [
  "<all_urls>"
],
```

(No `commands` changes — the in-app shortcut needs no manifest entry, and all 4 suggested-key slots stay with `open-collection-1..4`.)

- [ ] **Step 6: Wire into background.js**

(a) Add to the `importScripts` block (after line 9, `importScripts('background-utils.js');`):

```js
  importScripts('thumbnail-capture.js');
```

(b) Below the importScripts try/catch (after the `catch` block, alongside the other module bindings like `syncSessionStateApi`), add:

```js
  const thumbnailCaptureApi = typeof require === 'function'
    ? require('./thumbnail-capture.js')
    : globalThis.TaboxThumbnails;
  const thumbnailCapture = thumbnailCaptureApi.createThumbnailCapture(browser);
  thumbnailCapture.init();
```

(c) In the `browser.runtime.onMessage.addListener(async (request) => {` handler (line ~1408), add as the FIRST check, before `if (request.type === 'checkSyncStatus')`:

```js
    if (request.type === 'captureAllWindows') {
      await thumbnailCapture.captureAllWindows();
      return Promise.resolve(true);
    }
```

- [ ] **Step 7: Lint and build**

Run: `yarn lint && yarn prod`
Expected: both exit 0; `build/thumbnail-capture.js` and the manifest's `optional_host_permissions` present in `build/manifest.json` (verify: `grep -A2 optional_host build/manifest.json`)

- [ ] **Step 8: Commit**

```bash
git add chrome/thumbnail-capture.js chrome/manifest.json chrome/background.js tests/thumbnailCapture.test.js
git commit -m "feat(switcher): background thumbnail capture behind optional <all_urls> permission"
```

---

### Task 6: crxbox e2e tests

**Files:**
- Create: `e2e/tab-switcher.spec.mjs`

The native permission dialog can't be driven from Playwright, so the grant-and-capture path stays unit-tested (Task 5); e2e asserts everything else, including the un-granted preview fallback.

- [ ] **Step 1: Build first (e2e runs against `build/`)**

Run: `yarn prod`
Expected: exit 0

- [ ] **Step 2: Write the spec**

```js
// e2e/tab-switcher.spec.mjs
import { test, expect } from 'crxbox';
import { openFullPage } from './support/fixtures.mjs';

// Quick tab switcher: Ctrl/Cmd+Shift+S palette listing all open tabs.
// The in-app listener accepts ctrlKey OR metaKey, so Control+Shift+S works on every OS.

const pageUrl = (title) => `data:text/html,<title>${title}</title><h1>${title}</h1>`;

const openSwitcher = async (page) => {
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.tab-switcher-card')).toBeVisible();
};

test.describe('quick tab switcher', () => {
  test('Ctrl+Shift+S opens the switcher in the popup and lists tabs from other windows', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Alpha Page'), pageUrl('Beta Page')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Alpha Page' })).toBeVisible();
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Beta Page' })).toBeVisible();
    // window labels are rendered on rows
    await expect(popup.locator('.tab-switcher-window-badge').first()).toBeVisible();
  });

  test('the shortcut also works in the full-page view, and Escape closes it', async ({ ext }) => {
    const page = await openFullPage(ext);
    await openSwitcher(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tab-switcher-card')).toHaveCount(0);
  });

  test('header buttons open the switcher in both views', async ({ ext }) => {
    const popup = await ext.popup.open();
    await popup.locator('[data-testid="tab-switcher-button"]').click();
    await expect(popup.locator('.tab-switcher-card')).toBeVisible();

    const page = await openFullPage(ext);
    await page.locator('[data-testid="tab-switcher-button"]').click();
    await expect(page.locator('.tab-switcher-card')).toBeVisible();
  });

  test('typing filters across windows by title and highlights the match', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Unique Zebra Tab'), pageUrl('Plain Tab')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('zebra');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
    await expect(popup.locator('.tab-switcher-row')).toContainText('Unique Zebra Tab');
    await expect(popup.locator('.tab-switcher-match').first()).toBeVisible();
  });

  test('filtering by URL works too', async ({ ext }) => {
    await ext.windows.create({ tabs: ['data:text/html,<title>By Url</title>findme-in-url'] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('findme-in-url');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
  });

  test('Enter activates the selected tab and focuses its window', async ({ ext }) => {
    const win = await ext.windows.create({ tabs: [pageUrl('Target Alpha'), pageUrl('Target Beta')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-input').fill('target beta');
    await expect(popup.locator('.tab-switcher-row')).toHaveCount(1);
    await popup.keyboard.press('Enter');
    await expect.poll(async () => {
      const tabs = await ext.tabs.query({ windowId: win.id, active: true });
      return tabs[0]?.url || '';
    }).toContain('Target%20Beta');
  });

  test('clicking a row activates that tab', async ({ ext }) => {
    const win = await ext.windows.create({ tabs: [pageUrl('Click Alpha'), pageUrl('Click Beta')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await popup.locator('.tab-switcher-row', { hasText: 'Click Beta' }).click();
    await expect.poll(async () => {
      const tabs = await ext.tabs.query({ windowId: win.id, active: true });
      return tabs[0]?.url || '';
    }).toContain('Click%20Beta');
  });

  test('right-click opens the live-tab context menu and Close tab closes the tab', async ({ ext }) => {
    const win = await ext.windows.create({ tabs: [pageUrl('Keep Me'), pageUrl('Close Me')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    const row = popup.locator('.tab-switcher-row', { hasText: 'Close Me' });
    await row.click({ button: 'right' });
    await expect(popup.locator('.context-menu')).toBeVisible();
    // full live-tab action set
    for (const item of ['Switch to tab', 'Copy URL', 'Pin tab', 'Mute tab', 'Move to new window', 'Close tab']) {
      await expect(popup.locator('.context-menu-item', { hasText: item })).toBeVisible();
    }
    await popup.locator('.context-menu-item', { hasText: 'Close tab' }).click();
    await expect.poll(async () => (await ext.tabs.query({ windowId: win.id })).length).toBe(1);
    // the switcher stays open and drops the closed row
    await expect(popup.locator('.tab-switcher-row', { hasText: 'Close Me' })).toHaveCount(0);
  });

  test('without the optional permission the preview pane shows the fallback card and enable button', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Preview Target')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    await expect(popup.locator('.tab-switcher-preview')).toBeVisible();
    await expect(popup.locator('.tab-switcher-preview-card')).toBeVisible();
    await expect(popup.locator('.tab-switcher-enable-previews')).toHaveText('Enable tab previews');
  });

  test('arrow keys move the selection', async ({ ext }) => {
    await ext.windows.create({ tabs: [pageUrl('Nav One'), pageUrl('Nav Two')] });
    const popup = await ext.popup.open();
    await openSwitcher(popup);
    const selectedTitle = () => popup.locator('.tab-switcher-row.selected .tab-switcher-row-title').textContent();
    const before = await selectedTitle();
    await popup.keyboard.press('ArrowDown');
    const after = await selectedTitle();
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `yarn test:e2e e2e/tab-switcher.spec.mjs`
Expected: PASS. Notes if debugging:
- data: URLs in assertions arrive URL-encoded (`Target%20Beta`) — already handled above.
- The popup page itself appears as a row (it's a real tab in e2e); tests filter or use `hasText` to avoid relying on absolute counts except inside the dedicated window via `windowId`.
- If `Enter` flakes because window focus closes the popup page, assert only via `ext.tabs.query` polls (as written).

- [ ] **Step 4: Run the FULL e2e suite to catch regressions**

Run: `yarn test:e2e`
Expected: PASS (all 30 spec files)

- [ ] **Step 5: Commit**

```bash
git add e2e/tab-switcher.spec.mjs
git commit -m "test(switcher): crxbox e2e coverage for the quick tab switcher"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full verification battery**

```bash
yarn lint && yarn test && yarn prod && yarn test:e2e
```
Expected: all four exit 0. `yarn prod` is the required post-change verification per CLAUDE.md.

- [ ] **Step 2: Manual smoke (headed, optional but recommended)**

Run: `yarn test:e2e:headed e2e/tab-switcher.spec.mjs` and watch the switcher open/filter/switch.

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-06-10-quick-tab-switcher-design.md`, change `**Status:** Approved design, pending implementation plan` to `**Status:** Implemented (see docs/superpowers/plans/2026-06-10-quick-tab-switcher.md)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-10-quick-tab-switcher-design.md
git commit -m "docs: mark quick tab switcher spec as implemented"
```
