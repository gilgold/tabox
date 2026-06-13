# Smart Organize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the flagship "Smart Organize" Tabox AI tool — one AI call groups a live window's ungrouped tabs into Chrome tab groups (new + into existing), applies immediately via the service worker, with a persistent undo and a save-as-collection option.

**Architecture:** A pure engine (`smartOrganizeTabs`) turns a window read into a grouping plan via one structured AI call. A window-read helper produces `{ungroupedTabs, existingGroups}` for any windowId. The background service worker owns apply + undo (snapshot to `chrome.storage.local` before mutating, so undo survives popup close). The AI modal gets a flagship hero card and a Smart Organize panel; a persistent "Undo Smart Organize" chip lives beside the AI button in both toolbars.

**Tech Stack:** React 19, Jotai, Chrome `tabs`/`tabGroups` APIs (perms already present), the existing `aiClient` Prompt API wrapper, Jest 29 + RTL.

**Spec:** `docs/superpowers/specs/2026-06-13-smart-organize-design.md`

**Constraints:**
- `app/CollectionListOptions.css` has pre-existing uncommitted user changes — NEVER edit or commit it. Popup chip CSS goes in a committed file (the chip's own CSS or AIButton.css).
- Never commit untracked files outside what each task lists. Each task commits only its own files.
- After all tasks: `yarn test`, `yarn lint`, `yarn prod` must pass (CLAUDE.md).

---

## File structure

```
app/ai/tasks/smartOrganizeTabs.js     # NEW — engine: window read → AI plan
app/ai/readWindowStructure.js         # NEW — read a windowId → {ungroupedTabs, existingGroups, eligibleCount}
app/ai/useSmartOrganizeUndo.js        # NEW — hook reading the smartOrganizeUndo storage key (live)
chrome/background.js                   # MODIFY — smartOrganizeApply / smartOrganizeUndo message handlers
chrome/background-utils.js             # MODIFY — applySmartOrganizePlan / undoSmartOrganize / snapshot helpers
app/ai/aiTasks.js                      # MODIFY — smart-organize registry entry with featured:true
app/AIToolsModal.js / .css             # MODIFY — hero card + Smart Organize panel
app/SmartOrganizeUndoChip.js / .css    # NEW — persistent undo chip
app/CollectionListOptions.js           # MODIFY — render the chip in popup toolbar
app/fullpage/FPContentArea.js          # MODIFY — render the chip in full-page toolbar
tests/smartOrganizeTabs.test.js        # NEW
tests/readWindowStructure.test.js      # NEW
tests/smartOrganize.background.test.js # NEW
tests/useSmartOrganizeUndo.test.js     # NEW
tests/AIToolsModal.smartOrganize.test.js # NEW
tests/SmartOrganizeUndoChip.test.js    # NEW
```

Shared constant: Chrome tab-group colors `['grey','blue','red','yellow','green','pink','purple','cyan','orange']`. Storage key for undo: `smartOrganizeUndo`.

---

### Task SO-1: Grouping engine (`smartOrganizeTabs`)

**Files:**
- Create: `app/ai/tasks/smartOrganizeTabs.js`
- Test: `tests/smartOrganizeTabs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/smartOrganizeTabs.test.js
jest.mock('../app/ai/aiClient', () => ({
    createAISession: jest.fn(),
    promptForJSON: jest.fn(),
}));

import { createAISession, promptForJSON } from '../app/ai/aiClient';
import { buildOrganizePrompt, smartOrganizeTabs, GROUP_COLORS } from '../app/ai/tasks/smartOrganizeTabs';

const ungrouped = [
    { tabId: 11, title: 'React docs', url: 'https://react.dev/learn' },
    { tabId: 12, title: 'MDN array', url: 'https://developer.mozilla.org/x' },
    { tabId: 13, title: 'Gmail', url: 'https://mail.google.com' },
];
const existingGroups = [{ id: 99, title: 'Email', sampleTitles: ['Inbox'] }];

describe('buildOrganizePrompt', () => {
    test('includes ungrouped tab titles+domains and existing group names', () => {
        const prompt = buildOrganizePrompt({ ungroupedTabs: ungrouped, existingGroups });
        expect(prompt).toContain('React docs');
        expect(prompt).toContain('react.dev');
        expect(prompt).toContain('Email');
    });
});

describe('smartOrganizeTabs', () => {
    beforeEach(() => {
        createAISession.mockResolvedValue({ destroy: jest.fn() });
        promptForJSON.mockReset();
    });

    test('maps tabIndexes to tabIds, splits new groups vs additions', async () => {
        promptForJSON.mockResolvedValue({
            groups: [
                { name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1, 2] },
                { name: '', color: 'grey', existingGroupId: 99, tabIndexes: [3] },
            ],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.newGroups).toEqual([{ name: 'Docs', color: 'blue', tabIds: [11, 12] }]);
        expect(plan.additions).toEqual([{ groupId: 99, tabIds: [13] }]);
        expect(plan.skippedTabIds).toEqual([]);
    });

    test('clamps an invalid color to a palette color', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'X', color: 'chartreuse', existingGroupId: null, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(GROUP_COLORS).toContain(plan.newGroups[0].color);
    });

    test('treats an unknown existingGroupId as a new group', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Stuff', color: 'red', existingGroupId: 12345, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.additions).toEqual([]);
        expect(plan.newGroups[0].tabIds).toEqual([11]);
    });

    test('collects tabs the model left unplaced into an "Other" group', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        const other = plan.newGroups.find((g) => g.name === 'Other');
        expect(other.tabIds.sort()).toEqual([12, 13]);
    });

    test('caps at 50 tabs and reports the remainder as skipped', async () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ tabId: i + 1, title: `T${i}`, url: 'https://e.com' }));
        promptForJSON.mockResolvedValue({ groups: [] });
        const plan = await smartOrganizeTabs({ ungroupedTabs: many, existingGroups: [] });
        // first 50 unplaced -> Other; the 10 beyond the cap -> skipped
        expect(plan.skippedTabIds).toHaveLength(10);
        expect(plan.skippedTabIds).toContain(60);
    });

    test('drops unknown tabIndexes from the model output', async () => {
        promptForJSON.mockResolvedValue({
            groups: [{ name: 'Docs', color: 'blue', existingGroupId: null, tabIndexes: [1, 999] }],
        });
        const plan = await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups });
        expect(plan.newGroups[0].tabIds).toEqual([11]);
    });

    test('forwards the abort signal and destroys the session', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ groups: [] });
        const signal = new AbortController().signal;
        await smartOrganizeTabs({ ungroupedTabs: ungrouped, existingGroups, signal });
        expect(promptForJSON).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Object), signal);
        expect(destroy).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/smartOrganizeTabs.test.js`
Expected: FAIL — `Cannot find module '../app/ai/tasks/smartOrganizeTabs'`

- [ ] **Step 3: Write the implementation**

```js
// app/ai/tasks/smartOrganizeTabs.js
import { createAISession, promptForJSON } from '../aiClient';

export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const MAX_TABS = 50;
const MAX_NAME_LENGTH = 40;
const TITLE_TRUNC = 80;

const PLAN_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', maxLength: MAX_NAME_LENGTH },
                    color: { type: 'string', enum: GROUP_COLORS },
                    existingGroupId: { type: ['integer', 'null'] },
                    tabIndexes: { type: 'array', items: { type: 'integer' } },
                },
                required: ['tabIndexes'],
                additionalProperties: false,
            },
        },
    },
    required: ['groups'],
    additionalProperties: false,
};

function domainOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export function buildOrganizePrompt({ ungroupedTabs, existingGroups }) {
    const tabLines = ungroupedTabs.map((tab, i) => {
        const domain = domainOf(tab.url);
        const title = (tab.title || domain || 'Untitled').slice(0, TITLE_TRUNC);
        return `${i + 1}. ${title}${domain ? ` (${domain})` : ''}`;
    });
    const groupLines = (existingGroups || []).map((g) => (
        `- [id ${g.id}] "${g.title}"${g.sampleTitles?.length ? ` e.g. ${g.sampleTitles.slice(0, 3).join('; ')}` : ''}`
    ));
    return [
        'You organize a browser window. Cluster these ungrouped tabs into a small number of topical groups.',
        'If a tab clearly belongs to one of the existing groups, assign it there by setting existingGroupId to that id.',
        'Otherwise create a new group with a short Title Case name (2-4 words) and a color.',
        'Put anything that fits nothing into a group named "Other".',
        '',
        'Ungrouped tabs (referenced by number):',
        tabLines.join('\n'),
        '',
        existingGroups?.length ? `Existing groups:\n${groupLines.join('\n')}` : 'No existing groups.',
        '',
        'Respond with JSON: { "groups": [ { "name": "...", "color": "blue", "existingGroupId": null, "tabIndexes": [1,2] } ] }.',
        `Colors must be one of: ${GROUP_COLORS.join(', ')}.`,
    ].join('\n');
}

export async function smartOrganizeTabs({ ungroupedTabs, existingGroups = [], signal } = {}) {
    const capped = ungroupedTabs.slice(0, MAX_TABS);
    const skippedTabIds = ungroupedTabs.slice(MAX_TABS).map((t) => t.tabId);
    const indexToTabId = new Map(capped.map((t, i) => [i + 1, t.tabId]));
    const existingIds = new Set((existingGroups || []).map((g) => g.id));

    const session = await createAISession({
        systemPrompt: 'You group browser tabs by topic. Group names are short, specific, Title Case, no quotes or emojis.',
        temperature: 0.7,
        topK: 3,
        ...(signal ? { signal } : {}),
    });

    let raw;
    try {
        raw = await promptForJSON(session, buildOrganizePrompt({ ungroupedTabs: capped, existingGroups }), PLAN_SCHEMA, signal);
    } finally {
        session.destroy();
    }

    const placed = new Set();
    const newGroups = [];
    const additions = [];
    let colorCursor = 0;
    const nextColor = (c) => (GROUP_COLORS.includes(c) ? c : GROUP_COLORS[colorCursor++ % GROUP_COLORS.length]);

    for (const g of raw.groups || []) {
        const tabIds = (g.tabIndexes || [])
            .map((idx) => indexToTabId.get(idx))
            .filter((id) => id !== undefined && !placed.has(id));
        if (tabIds.length === 0) continue;
        tabIds.forEach((id) => placed.add(id));

        if (g.existingGroupId != null && existingIds.has(g.existingGroupId)) {
            additions.push({ groupId: g.existingGroupId, tabIds });
        } else {
            newGroups.push({ name: (g.name || 'Group').slice(0, MAX_NAME_LENGTH), color: nextColor(g.color), tabIds });
        }
    }

    // Anything in the capped set the model didn't place goes into "Other".
    const leftover = capped.map((t) => t.tabId).filter((id) => !placed.has(id));
    if (leftover.length > 0) {
        const existingOther = newGroups.find((g) => g.name === 'Other');
        if (existingOther) existingOther.tabIds.push(...leftover);
        else newGroups.push({ name: 'Other', color: nextColor('grey'), tabIds: leftover });
    }

    return { newGroups, additions, skippedTabIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/smartOrganizeTabs.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app/ai/tasks/smartOrganizeTabs.js tests/smartOrganizeTabs.test.js
git commit -m "feat(ai): add Smart Organize grouping engine"
```

---

### Task SO-2: Window-read helper (`readWindowStructure`)

**Files:**
- Create: `app/ai/readWindowStructure.js`
- Test: `tests/readWindowStructure.test.js`

Reads a given windowId and returns the data the engine + picker need. Excludes pinned tabs and the Tabox full-page tab; "ungrouped" = `groupId === -1` (Chrome's `TAB_GROUP_ID_NONE`).

- [ ] **Step 1: Write the failing test**

```js
// tests/readWindowStructure.test.js
import { browser } from '../static/globals';
import { readWindowStructure } from '../app/ai/readWindowStructure';

describe('readWindowStructure', () => {
    beforeEach(() => {
        browser.tabs.query = jest.fn();
        browser.tabGroups.query = jest.fn();
        browser.runtime.getURL = jest.fn(() => 'chrome-extension://abc/fullpage.html');
    });

    test('returns ungrouped eligible tabs and existing groups with sample titles', async () => {
        browser.tabs.query.mockResolvedValue([
            { id: 1, title: 'A', url: 'https://a.com', groupId: -1, pinned: false },
            { id: 2, title: 'B', url: 'https://b.com', groupId: 7, pinned: false },
            { id: 3, title: 'Pinned', url: 'https://p.com', groupId: -1, pinned: true },
            { id: 4, title: 'Tabox', url: 'chrome-extension://abc/fullpage.html', groupId: -1, pinned: false },
        ]);
        browser.tabGroups.query.mockResolvedValue([{ id: 7, title: 'Work', color: 'blue' }]);

        const result = await readWindowStructure(100);

        expect(result.ungroupedTabs).toEqual([{ tabId: 1, title: 'A', url: 'https://a.com' }]);
        expect(result.existingGroups).toEqual([{ id: 7, title: 'Work', sampleTitles: ['B'] }]);
        expect(result.eligibleCount).toBe(1);
        expect(browser.tabs.query).toHaveBeenCalledWith({ windowId: 100 });
    });

    test('handles a window with no groups', async () => {
        browser.tabs.query.mockResolvedValue([{ id: 1, title: 'A', url: 'https://a.com', groupId: -1, pinned: false }]);
        browser.tabGroups.query.mockResolvedValue([]);
        const result = await readWindowStructure(100);
        expect(result.existingGroups).toEqual([]);
        expect(result.ungroupedTabs).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/readWindowStructure.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/readWindowStructure.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/ai/readWindowStructure.js tests/readWindowStructure.test.js
git commit -m "feat(ai): add window-structure reader for Smart Organize"
```

---

### Task SO-3: Background apply + undo

**Files:**
- Modify: `chrome/background-utils.js` (add exported helpers near the other group helpers, e.g. after `applyChromeGroupSettings` ~line 1058)
- Modify: `chrome/background.js` (add two `if (request.type === ...)` branches in the `onMessage` listener, ~line 1409+)
- Test: `tests/smartOrganize.background.test.js`

The pure logic lives in `background-utils.js` so it's testable with mocked `browser.tabs`/`tabGroups`. The `background.js` change is just message routing.

- [ ] **Step 1: Write the failing test**

```js
// tests/smartOrganize.background.test.js
import { browser } from '../static/globals';
import { applySmartOrganizePlan, undoSmartOrganize, SMART_ORGANIZE_UNDO_KEY } from '../chrome/background-utils';

describe('applySmartOrganizePlan', () => {
    beforeEach(() => {
        browser.tabs.query = jest.fn().mockResolvedValue([
            { id: 1, groupId: -1 }, { id: 2, groupId: -1 }, { id: 3, groupId: 7 },
        ]);
        browser.tabs.group = jest.fn().mockResolvedValue(900);
        browser.tabs.ungroup = jest.fn().mockResolvedValue();
        browser.tabs.move = jest.fn().mockResolvedValue();
        browser.tabGroups.update = jest.fn().mockResolvedValue();
        browser.storage.local.set = jest.fn().mockResolvedValue();
        browser.storage.local.get = jest.fn().mockResolvedValue({});
        browser.windows.get = jest.fn().mockResolvedValue({ id: 100 });
    });

    test('writes an undo snapshot then creates groups and applies additions', async () => {
        const plan = {
            newGroups: [{ name: 'Docs', color: 'blue', tabIds: [1] }],
            additions: [{ groupId: 7, tabIds: [2] }],
            skippedTabIds: [],
        };
        const result = await applySmartOrganizePlan({ windowId: 100, plan, createdAt: 123 });

        // snapshot saved BEFORE mutation
        const saved = browser.storage.local.set.mock.calls[0][0][SMART_ORGANIZE_UNDO_KEY];
        expect(saved.windowId).toBe(100);
        expect(saved.orderedTabIds).toEqual([1, 2, 3]);
        expect(saved.affectedTabIds.sort()).toEqual([1, 2]);

        // addition uses existing groupId
        expect(browser.tabs.group).toHaveBeenCalledWith({ groupId: 7, tabIds: [2] });
        // new group created then titled/colored
        expect(browser.tabs.group).toHaveBeenCalledWith({ createProperties: { windowId: 100 }, tabIds: [1] });
        expect(browser.tabGroups.update).toHaveBeenCalledWith(900, { title: 'Docs', color: 'blue' });
        expect(result).toEqual(expect.objectContaining({ success: true, groupsCreated: 1, tabsAdded: 1 }));
    });
});

describe('undoSmartOrganize', () => {
    beforeEach(() => {
        browser.tabs.ungroup = jest.fn().mockResolvedValue();
        browser.tabs.move = jest.fn().mockResolvedValue();
        browser.tabs.query = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        browser.windows.get = jest.fn().mockResolvedValue({ id: 100 });
    });

    test('ungroups affected tabs, restores order, clears the key', async () => {
        browser.storage.local.get = jest.fn().mockResolvedValue({
            [SMART_ORGANIZE_UNDO_KEY]: { windowId: 100, orderedTabIds: [1, 2, 3], affectedTabIds: [1, 2] },
        });
        const result = await undoSmartOrganize({ windowId: 100 });
        expect(browser.tabs.ungroup).toHaveBeenCalledWith([1, 2]);
        expect(browser.storage.local.remove).toHaveBeenCalledWith(SMART_ORGANIZE_UNDO_KEY);
        expect(result.success).toBe(true);
    });

    test('returns expired and clears the key when the window is gone', async () => {
        browser.storage.local.get = jest.fn().mockResolvedValue({
            [SMART_ORGANIZE_UNDO_KEY]: { windowId: 100, orderedTabIds: [1], affectedTabIds: [1] },
        });
        browser.windows.get = jest.fn().mockRejectedValue(new Error('No window with id 100'));
        const result = await undoSmartOrganize({ windowId: 100 });
        expect(result).toEqual({ success: false, reason: 'expired' });
        expect(browser.storage.local.remove).toHaveBeenCalledWith(SMART_ORGANIZE_UNDO_KEY);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/smartOrganize.background.test.js`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement in `chrome/background-utils.js`**

Add near the other group helpers (export each):

```js
export const SMART_ORGANIZE_UNDO_KEY = 'smartOrganizeUndo';

// Apply a Smart Organize plan to a live window. Snapshots the window's current
// tab order + the set of tabs being grouped BEFORE mutating, so undo can fully
// restore. Tabs that no longer exist are skipped by Chrome.
export async function applySmartOrganizePlan({ windowId, plan, createdAt }) {
    const beforeTabs = await browser.tabs.query({ windowId });
    const orderedTabIds = beforeTabs.map((t) => t.id);
    const affectedTabIds = [
        ...plan.newGroups.flatMap((g) => g.tabIds),
        ...plan.additions.flatMap((a) => a.tabIds),
    ];

    await browser.storage.local.set({
        [SMART_ORGANIZE_UNDO_KEY]: {
            windowId,
            createdAt: createdAt || Date.now(),
            orderedTabIds,
            affectedTabIds,
            summary: { groupsCreated: plan.newGroups.length, tabsAdded: affectedTabIds.length },
        },
    });

    let groupsCreated = 0;
    let tabsAdded = 0;

    for (const add of plan.additions) {
        if (!add.tabIds.length) continue;
        try {
            await browser.tabs.group({ groupId: add.groupId, tabIds: add.tabIds });
            tabsAdded += add.tabIds.length;
        } catch (e) {
            console.error('Smart Organize: addition failed for group', add.groupId, e);
        }
    }

    for (const g of plan.newGroups) {
        if (!g.tabIds.length) continue;
        try {
            const groupId = await browser.tabs.group({ createProperties: { windowId }, tabIds: g.tabIds });
            await browser.tabGroups.update(groupId, { title: g.name, color: g.color });
            groupsCreated += 1;
            tabsAdded += g.tabIds.length;
        } catch (e) {
            console.error('Smart Organize: new group failed', g.name, e);
        }
    }

    return { success: true, groupsCreated, tabsAdded, skipped: plan.skippedTabIds?.length || 0 };
}

// Undo the last Smart Organize run: ungroup the tabs we grouped (empty new
// groups auto-remove; existing groups just lose the added tabs), then restore
// the original tab order best-effort. Clears the snapshot.
export async function undoSmartOrganize({ windowId } = {}) {
    const stored = await browser.storage.local.get(SMART_ORGANIZE_UNDO_KEY);
    const snap = stored[SMART_ORGANIZE_UNDO_KEY];
    if (!snap) return { success: false, reason: 'missing' };

    const targetWindowId = windowId ?? snap.windowId;
    try {
        await browser.windows.get(targetWindowId);
    } catch {
        await browser.storage.local.remove(SMART_ORGANIZE_UNDO_KEY);
        return { success: false, reason: 'expired' };
    }

    const affected = (snap.affectedTabIds || []).filter(Boolean);
    if (affected.length) {
        try {
            await browser.tabs.ungroup(affected);
        } catch (e) {
            console.error('Smart Organize undo: ungroup failed', e);
        }
    }

    // Restore original order best-effort: move surviving tabs back in sequence.
    const liveIds = new Set((await browser.tabs.query({ windowId: targetWindowId })).map((t) => t.id));
    let index = 0;
    for (const tabId of snap.orderedTabIds || []) {
        if (!liveIds.has(tabId)) continue;
        try {
            await browser.tabs.move(tabId, { index });
        } catch {
            // tab may be pinned or gone; skip
        }
        index += 1;
    }

    await browser.storage.local.remove(SMART_ORGANIZE_UNDO_KEY);
    return { success: true };
}
```

(If `background-utils.js` uses `const browser = ...` / a different import, match the file's existing `browser` reference — read the top of the file first.)

- [ ] **Step 4: Route the messages in `chrome/background.js`**

Inside the `browser.runtime.onMessage.addListener(async (request) => { ... })` body, add (and ensure the two helpers are imported from `./background-utils` alongside the existing imports):

```js
    if (request.type === 'smartOrganizeApply') {
      const result = await applySmartOrganizePlan({
        windowId: request.windowId,
        plan: request.plan,
        createdAt: request.createdAt,
      });
      return Promise.resolve(result);
    }

    if (request.type === 'smartOrganizeUndo') {
      const result = await undoSmartOrganize({ windowId: request.windowId });
      return Promise.resolve(result);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test tests/smartOrganize.background.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add chrome/background-utils.js chrome/background.js tests/smartOrganize.background.test.js
git commit -m "feat(ai): background apply/undo for Smart Organize with persistent snapshot"
```

---

### Task SO-4: Persistent undo hook (`useSmartOrganizeUndo`)

**Files:**
- Create: `app/ai/useSmartOrganizeUndo.js`
- Test: `tests/useSmartOrganizeUndo.test.js`

Reads the `smartOrganizeUndo` storage key and stays live via `storage.onChanged` (same pattern as `useTaboxAIEnabled`). Returns `{ snapshot, undo, dismiss }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/useSmartOrganizeUndo.test.js
import { renderHook, waitFor, act } from '@testing-library/react';
import { browser } from '../static/globals';
import { useSmartOrganizeUndo } from '../app/ai/useSmartOrganizeUndo';

describe('useSmartOrganizeUndo', () => {
    beforeEach(() => {
        browser.storage.local.get = jest.fn().mockResolvedValue({});
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true });
        jest.spyOn(browser.storage.onChanged, 'addListener');
        jest.spyOn(browser.storage.onChanged, 'removeListener');
    });
    afterEach(() => jest.restoreAllMocks());

    test('exposes the stored snapshot and reacts to storage changes', async () => {
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).toEqual({ windowId: 5 }));

        const listener = browser.storage.onChanged.addListener.mock.calls[0][0];
        act(() => listener({ smartOrganizeUndo: { newValue: undefined } }));
        expect(result.current.snapshot).toBeNull();
    });

    test('undo() sends the smartOrganizeUndo message for the snapshot window', async () => {
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).not.toBeNull());
        await act(async () => { await result.current.undo(); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'smartOrganizeUndo', windowId: 5 });
    });

    test('dismiss() clears the storage key without undoing', async () => {
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        browser.storage.local.get.mockResolvedValue({ smartOrganizeUndo: { windowId: 5 } });
        const { result } = renderHook(() => useSmartOrganizeUndo());
        await waitFor(() => expect(result.current.snapshot).not.toBeNull());
        await act(async () => { await result.current.dismiss(); });
        expect(browser.storage.local.remove).toHaveBeenCalledWith('smartOrganizeUndo');
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/useSmartOrganizeUndo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// app/ai/useSmartOrganizeUndo.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '../../static/globals';

const KEY = 'smartOrganizeUndo';

// Live view of the persistent Smart Organize undo snapshot. Drives the toolbar
// "Undo Smart Organize" chip; survives popup close because the snapshot lives
// in chrome.storage.local (written by the background on apply).
export function useSmartOrganizeUndo() {
    const [snapshot, setSnapshot] = useState(null);
    const loaded = useRef(false);

    useEffect(() => {
        browser.storage.local.get(KEY).then((items) => {
            if (!loaded.current) {
                setSnapshot(items[KEY] || null);
                loaded.current = true;
            }
        }).catch(() => {});

        const onChanged = (changes) => {
            if (changes[KEY]) {
                loaded.current = true;
                setSnapshot(changes[KEY].newValue || null);
            }
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => browser.storage.onChanged.removeListener(onChanged);
    }, []);

    const undo = useCallback(async () => {
        const windowId = snapshot?.windowId;
        return browser.runtime.sendMessage({ type: 'smartOrganizeUndo', windowId });
    }, [snapshot]);

    const dismiss = useCallback(async () => {
        await browser.storage.local.remove(KEY);
    }, []);

    return { snapshot, undo, dismiss };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/useSmartOrganizeUndo.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/ai/useSmartOrganizeUndo.js tests/useSmartOrganizeUndo.test.js
git commit -m "feat(ai): add persistent Smart Organize undo hook"
```

---

### Task SO-5: Registry `featured` flag + modal hero card

**Files:**
- Modify: `app/ai/aiTasks.js`
- Modify: `app/AIToolsModal.js` (tool-list render), `app/AIToolsModal.css`
- Test: `tests/AIToolsModal.smartOrganize.test.js` (hero-card portion; panel logic added in SO-6)

- [ ] **Step 1: Write the failing test**

```js
// tests/AIToolsModal.smartOrganize.test.js
import { act, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';

jest.mock('../app/utils/storageUtils', () => ({ loadAllCollections: jest.fn().mockResolvedValue([]) }));
jest.mock('../app/ai/readWindowStructure', () => ({ readWindowStructure: jest.fn().mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 }) }));
jest.mock('../app/ai/aiClient', () => ({ getAIAvailability: jest.fn().mockResolvedValue('available') }));

import AIToolsModal from '../app/AIToolsModal';

const openModal = async () => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    await act(async () => {
        render(<Provider store={store}><AIToolsModal updateRemoteData={jest.fn()} /></Provider>);
    });
    return store;
};

test('renders Smart Organize as a featured hero card with a Flagship badge', async () => {
    await openModal();
    expect(screen.getByText('Smart Organize')).toBeInTheDocument();
    expect(screen.getByText(/flagship/i)).toBeInTheDocument();
    expect(document.querySelector('.ai-hero-card')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/AIToolsModal.smartOrganize.test.js`
Expected: FAIL — no Smart Organize / hero card.

- [ ] **Step 3: Add the registry entry** in `app/ai/aiTasks.js`:

```js
import { MdDriveFileRenameOutline, MdAutoAwesomeMosaic } from 'react-icons/md';

export const AI_TOOLS = [
    {
        id: 'smart-organize',
        title: 'Smart Organize',
        description: 'Group this window’s loose tabs into tab groups automatically.',
        icon: MdAutoAwesomeMosaic,
        featured: true,
    },
    {
        id: 'auto-rename',
        title: 'Auto-name collection',
        description: 'Let AI suggest a name for a collection based on its tabs.',
        icon: MdDriveFileRenameOutline,
    },
];
```

- [ ] **Step 4: Render the hero card** in `app/AIToolsModal.js` tool-list section (where `AI_TOOLS.map(...)` renders the cards). Split featured vs regular:

```jsx
{!activeToolId && (
    <div className="ai-tools-list">
        {AI_TOOLS.filter((t) => t.featured).map((tool) => {
            const ToolIcon = tool.icon;
            return (
                <button key={tool.id} type="button" className="ai-hero-card" onClick={() => setActiveToolId(tool.id)}>
                    <span className="ai-hero-badge">Flagship</span>
                    <ToolIcon size={26} className="ai-hero-icon" />
                    <span className="ai-hero-title">{tool.title}</span>
                    <span className="ai-hero-description">{tool.description}</span>
                </button>
            );
        })}
        <div className="ai-tools-grid">
            {AI_TOOLS.filter((t) => !t.featured).map((tool) => {
                const ToolIcon = tool.icon;
                return (
                    <button key={tool.id} type="button" className="ai-tool-card" onClick={() => setActiveToolId(tool.id)}>
                        <ToolIcon size={22} className="ai-tool-card-icon" />
                        <span className="ai-tool-card-title">{tool.title}</span>
                        <span className="ai-tool-card-description">{tool.description}</span>
                    </button>
                );
            })}
        </div>
    </div>
)}
```

(Adapt to the exact current JSX — the existing `.ai-tools-list` already maps all tools; replace that map with the featured/regular split above. Keep the existing per-tool-card classes intact for the non-featured branch.)

- [ ] **Step 5: Add hero-card CSS** to `app/AIToolsModal.css`:

```css
.ai-hero-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
    border: 1px solid transparent;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    color: #fff;
    background:
        linear-gradient(var(--background-color, #1e1e2e), var(--background-color, #1e1e2e)) padding-box,
        linear-gradient(120deg, #7c3aed, #2563eb, #38bdf8, #ec4899) border-box;
    border: 1px solid transparent;
    background-color: rgba(124, 58, 237, 0.10);
}
.ai-hero-card:hover { box-shadow: 0 0 14px rgba(124, 58, 237, 0.35); }
.ai-hero-card:focus-visible { outline: 2px solid rgba(124, 58, 237, 0.6); outline-offset: 2px; }
.ai-hero-badge {
    position: absolute; top: 10px; right: 10px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
    padding: 2px 7px; border-radius: 999px;
    background: linear-gradient(135deg, #7c3aed, #2563eb); color: #fff;
}
.ai-hero-icon { color: #a78bfa; }
.ai-hero-title { font-size: 15px; font-weight: 700; color: var(--text-color); }
.ai-hero-description { font-size: 12px; opacity: 0.8; color: var(--text-color); }
.ai-tools-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
.ai-tools-modal--fullpage .ai-tools-grid { grid-template-columns: 1fr 1fr; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn test tests/AIToolsModal.smartOrganize.test.js tests/AIToolsModal.test.js`
Expected: PASS (hero test passes; existing modal tests still pass — if the existing auto-rename tool-list test asserts on `.ai-tools-list` structure, adjust selectors minimally so both pass).

- [ ] **Step 7: Commit**

```bash
git add app/ai/aiTasks.js app/AIToolsModal.js app/AIToolsModal.css tests/AIToolsModal.smartOrganize.test.js
git commit -m "feat(ai): flagship hero card for Smart Organize in AI tools modal"
```

---

### Task SO-6: Smart Organize panel (idle → running → done)

**Files:**
- Modify: `app/AIToolsModal.js` (+ `.css` for picker/summary rows)
- Test: `tests/AIToolsModal.smartOrganize.test.js` (extend)

The panel renders when `activeToolId === 'smart-organize'`. Reuses the busy-lockout, AbortController, and run-token machinery already in the modal.

Behavior:
- **On entering the panel:** determine the target window. Popup (`viewContext !== 'fullpage'`) → `browser.windows.getCurrent()` → that windowId, read via `readWindowStructure`. Full-page → show a window picker built from `browser.windows.getAll({ populate: true })` (id, a label = the active tab's title + tab count, and the ungrouped count via `readWindowStructure`); selecting one sets the target.
- **idle:** "Organize N ungrouped tabs" + Run button; disabled with "Everything here is already grouped." when N === 0. If `useSmartOrganizeUndo().snapshot` exists, show an "Undo last organize" row.
- **run:** pre-flight `getAIAvailability() !== 'available'` → error, stop. Else status running; `smartOrganizeTabs({ ungroupedTabs, existingGroups, signal })`; then `browser.runtime.sendMessage({ type: 'smartOrganizeApply', windowId, plan, createdAt: Date.now() })`; on success → status done + show summary; fire `showUndoToast(<BsStars/>, 'Organized N tabs into groups', 'Smart Organize', () => browser.runtime.sendMessage({ type: 'smartOrganizeUndo', windowId }), UNDO_TIME)`. Cancel via AbortController; close locked while running.
- **done:** summary ("Created X groups · added Y tabs to existing groups · Z left ungrouped") + three buttons: **Save as collection** (read the window now via `getCurrentTabsAndGroups` if popup / the picked window otherwise, build the snapshot, call a passed-in `addCollection`-style save; reuse `buildCollectionFromSnapshot` + the modal's `updateRemoteData`/save path — simplest: send to the existing save flow. If wiring `addCollection` into the modal is heavy, use `loadAllCollections` + `updateRemoteData([...all, newCollection])`), **Undo** (sends `smartOrganizeUndo`), **Close**.

- [ ] **Step 1: Write the failing tests** (extend `tests/AIToolsModal.smartOrganize.test.js`)

```js
import { fireEvent, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';

jest.mock('../app/ai/tasks/smartOrganizeTabs', () => ({ smartOrganizeTabs: jest.fn() }));
jest.mock('../app/toastHelpers', () => ({ showUndoToast: jest.fn(), showSuccessToast: jest.fn() }));
import { smartOrganizeTabs } from '../app/ai/tasks/smartOrganizeTabs';
import { readWindowStructure } from '../app/ai/readWindowStructure';
import { showUndoToast } from '../app/toastHelpers';

describe('Smart Organize panel (popup)', () => {
    beforeEach(() => {
        browser.windows.getCurrent = jest.fn().mockResolvedValue({ id: 100 });
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true, groupsCreated: 2, tabsAdded: 5, skipped: 0 });
        readWindowStructure.mockResolvedValue({
            ungroupedTabs: [{ tabId: 1, title: 'A', url: 'https://a.com' }, { tabId: 2, title: 'B', url: 'https://b.com' }],
            existingGroups: [], eligibleCount: 2,
        });
        smartOrganizeTabs.mockResolvedValue({ newGroups: [{ name: 'Docs', color: 'blue', tabIds: [1, 2] }], additions: [], skippedTabIds: [] });
    });

    test('shows the ungrouped count, runs, applies, and fires the undo toast', async () => {
        await openModal(); // helper from SO-5 test
        fireEvent.click(screen.getByText('Smart Organize'));
        await waitFor(() => expect(screen.getByText(/2 ungrouped tabs/i)).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /organize/i }));

        await waitFor(() => expect(smartOrganizeTabs).toHaveBeenCalled());
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'smartOrganizeApply', windowId: 100 })
        ));
        await waitFor(() => expect(showUndoToast).toHaveBeenCalled());
        expect(screen.getByText(/created 2 groups/i)).toBeInTheDocument();
    });

    test('disables run when there are no ungrouped tabs', async () => {
        readWindowStructure.mockResolvedValue({ ungroupedTabs: [], existingGroups: [], eligibleCount: 0 });
        await openModal();
        fireEvent.click(screen.getByText('Smart Organize'));
        await waitFor(() => expect(screen.getByText(/already grouped/i)).toBeInTheDocument());
    });
});
```

(Make `openModal` reusable across the file. The "Smart Organize" click target is the hero card from SO-5.)

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test tests/AIToolsModal.smartOrganize.test.js`
Expected: FAIL — panel not implemented.

- [ ] **Step 3: Implement the panel** in `app/AIToolsModal.js`. Add state (`soTarget`, `soWindows`, `soStructure`, `soSummary`), an effect that resolves the target window when `activeToolId === 'smart-organize'`, the `handleSmartOrganizeRun` handler (mirroring `handleRun`'s token/abort/busy guards), and the panel JSX (`activeToolId === 'smart-organize'`). Wire the done-state Save-as-collection to the modal's existing persistence (`updateRemoteData` with a freshly built collection from `buildCollectionFromSnapshot`). Render `useSmartOrganizeUndo()`'s undo affordance in the idle/done states. Use the exact behaviors in the task header.

(Full handler code — the implementer should follow the existing `handleRun` structure in the same file for token/abort/busy/pre-flight, swapping the engine call for `smartOrganizeTabs` and the apply for the `smartOrganizeApply` message. Keep the summary string format `Created ${groupsCreated} groups · added ${tabsAdded - newGroupTabs} tabs to existing groups · ${skipped} left ungrouped` — compute parts from the apply result.)

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test tests/AIToolsModal.smartOrganize.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/AIToolsModal.js app/AIToolsModal.css tests/AIToolsModal.smartOrganize.test.js
git commit -m "feat(ai): Smart Organize panel with run, apply, undo and save-as-collection"
```

---

### Task SO-7: Persistent "Undo Smart Organize" chip in both toolbars

**Files:**
- Create: `app/SmartOrganizeUndoChip.js`, `app/SmartOrganizeUndoChip.css`
- Modify: `app/CollectionListOptions.js` (render the chip in the toolbar, next to `<AIButton />`)
- Modify: `app/fullpage/FPContentArea.js` (render the chip in the default toolbar, next to `<AIButton />`)
- Test: `tests/SmartOrganizeUndoChip.test.js`

The chip renders only when a snapshot exists AND Tabox AI is enabled+supported. Clicking it undoes; the `×` dismisses.

- [ ] **Step 1: Write the failing test**

```js
// tests/SmartOrganizeUndoChip.test.js
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { browser } from '../static/globals';
import SmartOrganizeUndoChip from '../app/SmartOrganizeUndoChip';

describe('SmartOrganizeUndoChip', () => {
    beforeEach(() => {
        browser.storage.local.get = jest.fn();
        browser.runtime.sendMessage = jest.fn().mockResolvedValue({ success: true });
        browser.storage.local.remove = jest.fn().mockResolvedValue();
        globalThis.LanguageModel = { availability: jest.fn() };
    });
    afterEach(() => { delete globalThis.LanguageModel; });

    test('renders when a snapshot exists and undoes on click', async () => {
        browser.storage.local.get.mockImplementation((k) =>
            Promise.resolve(k === 'chkTaboxAI' ? { chkTaboxAI: true } : { smartOrganizeUndo: { windowId: 5 } }));
        render(<SmartOrganizeUndoChip />);
        await waitFor(() => expect(screen.getByRole('button', { name: /undo smart organize/i })).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /undo smart organize/i })); });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'smartOrganizeUndo', windowId: 5 });
    });

    test('renders nothing when there is no snapshot', async () => {
        browser.storage.local.get.mockImplementation((k) =>
            Promise.resolve(k === 'chkTaboxAI' ? { chkTaboxAI: true } : {}));
        const { container } = render(<SmartOrganizeUndoChip />);
        await waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
        expect(container.querySelector('.so-undo-chip')).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test tests/SmartOrganizeUndoChip.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chip**

```jsx
// app/SmartOrganizeUndoChip.js
import React from 'react';
import { MdUndo, MdClose } from 'react-icons/md';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import { isAISupported } from './ai/aiClient';
import { useSmartOrganizeUndo } from './ai/useSmartOrganizeUndo';
import './SmartOrganizeUndoChip.css';

function SmartOrganizeUndoChip() {
    const enabled = useTaboxAIEnabled();
    const { snapshot, undo, dismiss } = useSmartOrganizeUndo();

    if (!enabled || !isAISupported() || !snapshot) return null;

    return (
        <div className="so-undo-chip">
            <button
                type="button"
                className="so-undo-chip-action"
                onClick={() => undo()}
                aria-label="Undo Smart Organize"
                data-tooltip-id="main-tooltip"
                data-tooltip-content="Undo the last Smart Organize"
            >
                <MdUndo size={14} />
                <span>Undo organize</span>
            </button>
            <button type="button" className="so-undo-chip-dismiss" onClick={() => dismiss()} aria-label="Dismiss undo">
                <MdClose size={13} />
            </button>
        </div>
    );
}

export default SmartOrganizeUndoChip;
```

```css
/* app/SmartOrganizeUndoChip.css */
.so-undo-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 4px 0 8px;
    border-radius: 14px;
    background: rgba(124, 58, 237, 0.12);
    border: 1px solid rgba(124, 58, 237, 0.4);
    flex-shrink: 0;
}
.so-undo-chip-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    font-size: 12px;
    font-weight: 600;
}
.so-undo-chip-dismiss {
    display: inline-flex;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    opacity: 0.6;
    padding: 2px;
}
.so-undo-chip-dismiss:hover { opacity: 1; }
```

- [ ] **Step 4: Render in both toolbars.** In `app/CollectionListOptions.js`, import and place `<SmartOrganizeUndoChip />` immediately before `<AIButton withDivider />`. In `app/fullpage/FPContentArea.js`, import and place `<SmartOrganizeUndoChip />` immediately before `<AIButton withDivider />` in `renderDefaultCollectionToolbarControls()`.

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test tests/SmartOrganizeUndoChip.test.js tests/CollectionListOptions.test.js tests/AIButton.test.js`
Expected: PASS (chip tests pass; toolbar suites still pass — chip renders null with storage unset, so snapshots should be unchanged; if a snapshot changes, verify it's only the chip and update with `-u`).

- [ ] **Step 6: Commit**

```bash
git add app/SmartOrganizeUndoChip.js app/SmartOrganizeUndoChip.css app/CollectionListOptions.js app/fullpage/FPContentArea.js tests/SmartOrganizeUndoChip.test.js
# include a snapshot file ONLY if it legitimately changed (chip-only diff)
git commit -m "feat(ai): persistent Undo Smart Organize chip in both toolbars"
```

---

### Task SO-8: Full verification + review

- [ ] **Step 1:** `yarn test` — all suites pass (a jest worker SIGSEGV flake exists; if a suite reports a failure with 0 failing tests, re-run that suite in isolation before treating it as a real failure).
- [ ] **Step 2:** `yarn lint` — clean.
- [ ] **Step 3:** `yarn prod` — compiles.
- [ ] **Step 4: Manual smoke (Chrome 138+):** follow §11 of the spec — organize a messy window, undo from toast, re-run + close popup + reopen + undo from the persistent chip, save-as-collection, full-page window picker, AI-disabled hides the feature, >50 tabs reports remainder.
- [ ] **Step 5:** Use superpowers:finishing-a-development-branch.

---

## Self-review notes

- **Spec coverage:** §2 scope → SO-1/SO-2/SO-6; §4 engine → SO-1; §5 apply/undo → SO-3; §6 persistent surface → SO-4 (hook) + SO-7 (chip) + SO-6 (toast/in-modal); §7 flagship + panel → SO-5/SO-6; §8 files → all tasks; §9 edge cases → SO-1 (cap/unplaced), SO-2 (eligibility), SO-3 (missing tabs/expired window), SO-6 (no tabs/AI unavailable/cancel); §10 testing → each task's tests; §11 manual → SO-8.
- **Type consistency:** plan shape `{ newGroups:[{name,color,tabIds}], additions:[{groupId,tabIds}], skippedTabIds }` is identical across SO-1, SO-3, SO-6. Storage key `smartOrganizeUndo` / `SMART_ORGANIZE_UNDO_KEY` consistent across SO-3/SO-4. Message types `smartOrganizeApply` / `smartOrganizeUndo` consistent across SO-3/SO-4/SO-6/SO-7.
- **Constraint:** no task edits `app/CollectionListOptions.css`; chip styling is in `SmartOrganizeUndoChip.css`.
