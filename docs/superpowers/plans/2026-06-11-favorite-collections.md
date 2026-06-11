# Favorite Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can star any collection to pin it into a "Favorites" section shown at the top of both the popup and the full-page view, with manual drag-and-drop ordering inside the section.

**Architecture:** Two new fields on the collection object (`isFavorite: boolean`, `favoriteOrder: number`) persisted through the existing indexed storage (`collections_index` + `collection_<uid>`), mirroring the `parentId`/`order` pattern. The Favorites section is a self-contained component per surface — `app/FavoritesSection.js` (popup) and `app/fullpage/FPFavoritesSection.js` (full page) — each with its **own** `DndContext` so the existing, intricate collision-detection logic in `CollectionList.js` / `FPContentArea.js` is untouched. Sortable IDs inside Favorites are namespaced `fav:<uid>` because the same collection also renders in its normal location. Google Drive sync picks the new fields up automatically (sync uploads all collection fields). No storage version bump: a missing `isFavorite` reads as not-favorite.

**Tech Stack:** React 19, Jotai, @dnd-kit, Jest 29 + React Testing Library, plain CSS. JavaScript only — no TypeScript annotations anywhere.

**Spec:** `docs/superpowers/specs/2026-06-11-favorite-collections-design.md`

**Project rules (from CLAUDE.md and memory — apply to every task):**
- Never run per-item collection storage writes in parallel; reorders go through ONE batch write (`batchUpdateCollections` via `updateRemoteData`).
- After all tasks complete, `yarn prod` must pass (Task 7).
- Run `yarn test <file>` per task; commit after each task.

---

### Task 1: `favoritesUtils` pure helpers (TDD)

**Files:**
- Create: `app/utils/favoritesUtils.js`
- Test: `tests/favoritesUtils.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/favoritesUtils.test.js`:

```js
import {
    getFavoriteCollections,
    getNextFavoriteOrder,
    buildFavoritesReorderUpdate,
} from '../app/utils/favoritesUtils';

jest.mock('../app/utils/storageUtils', () => ({
    loadCollectionsIndex: jest.fn(),
}));

const { loadCollectionsIndex } = jest.requireMock('../app/utils/storageUtils');

describe('getFavoriteCollections', () => {
    it('returns only favorited collections sorted by favoriteOrder', () => {
        const collections = [
            { uid: 'a', isFavorite: true, favoriteOrder: 2 },
            { uid: 'b', isFavorite: false },
            { uid: 'c', isFavorite: true, favoriteOrder: 0 },
            { uid: 'd' },
            { uid: 'e', isFavorite: true, favoriteOrder: 1 },
        ];
        expect(getFavoriteCollections(collections).map(c => c.uid)).toEqual(['c', 'e', 'a']);
    });

    it('sorts favorites with missing favoriteOrder last, newest lastUpdated first among them', () => {
        const collections = [
            { uid: 'a', isFavorite: true, lastUpdated: 100 },
            { uid: 'b', isFavorite: true, favoriteOrder: 0 },
            { uid: 'c', isFavorite: true, lastUpdated: 200 },
        ];
        expect(getFavoriteCollections(collections).map(c => c.uid)).toEqual(['b', 'c', 'a']);
    });

    it('returns empty array for undefined input', () => {
        expect(getFavoriteCollections(undefined)).toEqual([]);
    });
});

describe('getNextFavoriteOrder', () => {
    it('returns max favoriteOrder + 1 across favorited index entries', async () => {
        loadCollectionsIndex.mockResolvedValue({
            a: { isFavorite: true, favoriteOrder: 3 },
            b: { isFavorite: true, favoriteOrder: 7 },
            c: { isFavorite: false, favoriteOrder: 99 },
        });
        await expect(getNextFavoriteOrder()).resolves.toBe(8);
    });

    it('returns 0 when there are no favorites', async () => {
        loadCollectionsIndex.mockResolvedValue({ a: { isFavorite: false } });
        await expect(getNextFavoriteOrder()).resolves.toBe(0);
    });

    it('treats favorites with missing favoriteOrder as order -1', async () => {
        loadCollectionsIndex.mockResolvedValue({ a: { isFavorite: true } });
        await expect(getNextFavoriteOrder()).resolves.toBe(0);
    });
});

describe('buildFavoritesReorderUpdate', () => {
    it('stamps sequential favoriteOrder onto reordered favorites, leaves others untouched', () => {
        const all = [
            { uid: 'a', isFavorite: true, favoriteOrder: 0 },
            { uid: 'b', isFavorite: false },
            { uid: 'c', isFavorite: true, favoriteOrder: 1 },
        ];
        const reordered = [all[2], all[0]]; // c first, a second
        const result = buildFavoritesReorderUpdate(all, reordered);
        expect(result.find(c => c.uid === 'c').favoriteOrder).toBe(0);
        expect(result.find(c => c.uid === 'a').favoriteOrder).toBe(1);
        expect(result.find(c => c.uid === 'b')).toBe(all[1]); // untouched reference
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/favoritesUtils.test.js`
Expected: FAIL — module `app/utils/favoritesUtils.js` not found.

- [ ] **Step 3: Write the implementation**

Create `app/utils/favoritesUtils.js`:

```js
/**
 * Helpers for the Favorites feature.
 * Favorites are collections with isFavorite === true; their position inside the
 * Favorites section is favoriteOrder (lower = first). Missing favoriteOrder
 * sorts last (stable fallback to newest lastUpdated first).
 */

import { loadCollectionsIndex } from './storageUtils';

const normalizedFavoriteOrder = (entry) => (
    typeof entry.favoriteOrder === 'number' ? entry.favoriteOrder : null
);

export const compareFavorites = (a, b) => {
    const aOrder = normalizedFavoriteOrder(a);
    const bOrder = normalizedFavoriteOrder(b);
    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== null && bOrder === null) return -1;
    if (aOrder === null && bOrder !== null) return 1;
    return (b.lastUpdated || 0) - (a.lastUpdated || 0);
};

export const getFavoriteCollections = (collections = []) => (
    collections
        .filter((collection) => collection.isFavorite === true)
        .sort(compareFavorites)
);

export const getNextFavoriteOrder = async () => {
    const index = await loadCollectionsIndex();
    const orders = Object.values(index)
        .filter((entry) => entry.isFavorite === true)
        .map((entry) => (typeof entry.favoriteOrder === 'number' ? entry.favoriteOrder : -1));
    return orders.length > 0 ? Math.max(...orders) + 1 : 0;
};

export const buildFavoritesReorderUpdate = (collections, reorderedFavorites) => {
    const orderByUid = new Map(reorderedFavorites.map((collection, index) => [collection.uid, index]));
    return collections.map((collection) => (
        orderByUid.has(collection.uid)
            ? { ...collection, favoriteOrder: orderByUid.get(collection.uid) }
            : collection
    ));
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test tests/favoritesUtils.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/favoritesUtils.js tests/favoritesUtils.test.js
git commit -m "feat(favorites): add favorites sorting and ordering helpers"
```

---

### Task 2: Persist `isFavorite` / `favoriteOrder` in storage index (TDD)

The full record already persists the new fields automatically (`saveSingleCollection` spreads `...collectionToSave` into the record at `app/utils/storageUtils.js:549`, and merges `existingCollection` at line 529, so partial updates preserve them). What's missing: the **index entries** are built field-by-field and must carry the favorite fields so the UI can render Favorites from the fast index; and `batchUpdateCollections` must not drop the fields when an incoming object lacks them.

**Files:**
- Modify: `app/utils/storageUtils.js:557-568` (saveSingleCollection index entry) and `app/utils/storageUtils.js:1068-1166` (batchUpdateCollections)
- Test: `tests/favoritesStorage.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/favoritesStorage.test.js`:

```js
jest.mock('../static/globals', () => {
    const store = {};
    const normalizeKeys = (keys) => (Array.isArray(keys) ? keys : [keys]);
    return {
        __store: store,
        browser: {
            storage: {
                local: {
                    get: jest.fn(async (keys) => {
                        if (keys === null || keys === undefined) return { ...store };
                        const result = {};
                        normalizeKeys(keys).forEach((key) => {
                            if (key in store) result[key] = store[key];
                        });
                        return result;
                    }),
                    set: jest.fn(async (data) => { Object.assign(store, data); }),
                    remove: jest.fn(async (keys) => {
                        normalizeKeys(keys).forEach((key) => { delete store[key]; });
                    }),
                },
            },
        },
    };
});

import { saveSingleCollection, batchUpdateCollections, STORAGE_KEYS } from '../app/utils/storageUtils';

const { __store: store } = jest.requireMock('../static/globals');

const baseCollection = (overrides = {}) => ({
    uid: 'col-1',
    name: 'Test',
    tabs: [{ uid: 't1', url: 'https://example.com' }],
    chromeGroups: [],
    color: 'blue',
    createdOn: 1000,
    lastUpdated: 2000,
    ...overrides,
});

beforeEach(() => {
    Object.keys(store).forEach((key) => { delete store[key]; });
    jest.clearAllMocks();
});

describe('saveSingleCollection favorite fields', () => {
    it('persists isFavorite and favoriteOrder to both record and index', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 2 }));
        const record = store[`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`];
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(record.isFavorite).toBe(true);
        expect(record.favoriteOrder).toBe(2);
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(2);
    });

    it('defaults isFavorite to false in the index when missing', async () => {
        await saveSingleCollection(baseCollection());
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });

    it('clears favorite state when toggled off with favoriteOrder null', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 0 }));
        await saveSingleCollection(baseCollection({ isFavorite: false, favoriteOrder: null }));
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });
});

describe('batchUpdateCollections favorite fields', () => {
    it('writes favorite fields to record and index in one batch', async () => {
        await saveSingleCollection(baseCollection());
        await batchUpdateCollections([baseCollection({ isFavorite: true, favoriteOrder: 5 })]);
        const record = store[`${STORAGE_KEYS.COLLECTION_PREFIX}col-1`];
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(record.isFavorite).toBe(true);
        expect(record.favoriteOrder).toBe(5);
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(5);
    });

    it('preserves favorite fields when an incoming complete object lacks them', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 1 }));
        const staleObject = baseCollection(); // tabs/chromeGroups present, no favorite fields
        delete staleObject.isFavorite;
        delete staleObject.favoriteOrder;
        await batchUpdateCollections([staleObject]);
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(true);
        expect(indexEntry.favoriteOrder).toBe(1);
    });

    it('clears favorite fields when explicitly toggled off in a batch', async () => {
        await saveSingleCollection(baseCollection({ isFavorite: true, favoriteOrder: 1 }));
        await batchUpdateCollections([baseCollection({ isFavorite: false, favoriteOrder: null })]);
        const indexEntry = store[STORAGE_KEYS.COLLECTIONS_INDEX]['col-1'];
        expect(indexEntry.isFavorite).toBe(false);
        expect(indexEntry).not.toHaveProperty('favoriteOrder');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/favoritesStorage.test.js`
Expected: FAIL — index entries have no `isFavorite` property (`expect(indexEntry.isFavorite).toBe(true)` receives `undefined`).
Note: the first `saveSingleCollection` test may partially pass for the *record* assertions (spread already persists fields) — the index assertions must fail.

- [ ] **Step 3: Implement in `saveSingleCollection`**

In `app/utils/storageUtils.js`, the index entry assignment currently ends like this (lines 557-568):

```js
        index[normalizedIncomingCollection.uid] = {
            name: collectionToSave.name,
            type: 'collection',
            tabCount: collectionToSave.tabs ? collectionToSave.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
            createdOn: collectionToSave.createdOn || now,
            color: collectionToSave.color || 'default',
            size: collectionSize,
            parentId: collectionToSave.parentId || null,
            order: resolvedOrder
        };
```

Replace with:

```js
        index[normalizedIncomingCollection.uid] = {
            name: collectionToSave.name,
            type: 'collection',
            tabCount: collectionToSave.tabs ? collectionToSave.tabs.length : 0,
            lastUpdated: lastUpdated,
            lastOpened: collectionToSave.lastOpened !== null && collectionToSave.lastOpened !== undefined ? collectionToSave.lastOpened : null,
            createdOn: collectionToSave.createdOn || now,
            color: collectionToSave.color || 'default',
            size: collectionSize,
            parentId: collectionToSave.parentId || null,
            order: resolvedOrder,
            isFavorite: collectionToSave.isFavorite === true,
            ...(collectionToSave.isFavorite === true && typeof collectionToSave.favoriteOrder === 'number'
                ? { favoriteOrder: collectionToSave.favoriteOrder }
                : {})
        };
```

- [ ] **Step 4: Implement in `batchUpdateCollections`**

In `app/utils/storageUtils.js`, inside the `collections.forEach(collection => { ... })` loop, after the order-resolution block that ends with the comment `// If collection has order but index doesn't, keep collection's order` (around line 1117) and before `const collectionSize = JSON.stringify(collectionForStorage).length;`, add:

```js
            // Favorite fields: prefer incoming values, fall back to the existing
            // index entry so stale in-memory objects can't silently un-favorite
            const resolvedIsFavorite = collection.isFavorite !== undefined
                ? collection.isFavorite === true
                : existingIndexEntry.isFavorite === true;
            const resolvedFavoriteOrder = collection.favoriteOrder !== undefined
                ? collection.favoriteOrder
                : existingIndexEntry.favoriteOrder;
            
            collectionForStorage.isFavorite = resolvedIsFavorite;
            if (resolvedIsFavorite && typeof resolvedFavoriteOrder === 'number') {
                collectionForStorage.favoriteOrder = resolvedFavoriteOrder;
            } else {
                delete collectionForStorage.favoriteOrder;
            }
```

Then in the `indexEntry` literal (currently lines 1129-1139, ending with `parentId: collectionForStorage.parentId || null`), add after `parentId`:

```js
                isFavorite: resolvedIsFavorite,
                ...(resolvedIsFavorite && typeof resolvedFavoriteOrder === 'number'
                    ? { favoriteOrder: resolvedFavoriteOrder }
                    : {})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test tests/favoritesStorage.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full existing storage-related suites to catch regressions**

Run: `yarn test tests/migrateLegacyStorage.test.js && yarn test`
Expected: PASS (no existing test asserts the exact shape of index entries in a way the two added keys break — if one does, update the expected object in that test to include `isFavorite: false`).

- [ ] **Step 7: Commit**

```bash
git add app/utils/storageUtils.js tests/favoritesStorage.test.js
git commit -m "feat(favorites): persist isFavorite/favoriteOrder in collection records and index"
```

---

### Task 3: Toggle operation + shared context-menu entry

**Files:**
- Modify: `app/useCollectionOperations.js` (add `_handleToggleFavorite`)
- Modify: `app/utils/contextMenuItems.js` (add favorite menu item)
- Test: `tests/contextMenuItems.favorite.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/contextMenuItems.favorite.test.js`:

```js
import { createCollectionMenuItems } from '../app/utils/contextMenuItems';

describe('createCollectionMenuItems favorite entry', () => {
    it('shows "Add to Favorites" when not favorited', () => {
        const items = createCollectionMenuItems({ isFavorite: false, onToggleFavorite: jest.fn() });
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem).toBeDefined();
        expect(favoriteItem.text).toBe('Add to Favorites');
        expect(favoriteItem.condition).toBe(true);
    });

    it('shows "Remove from Favorites" when favorited', () => {
        const items = createCollectionMenuItems({ isFavorite: true, onToggleFavorite: jest.fn() });
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem.text).toBe('Remove from Favorites');
    });

    it('hides the entry when no handler is provided', () => {
        const items = createCollectionMenuItems({});
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem.condition).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/contextMenuItems.favorite.test.js`
Expected: FAIL — `favoriteItem` is undefined.

- [ ] **Step 3: Implement the menu item**

In `app/utils/contextMenuItems.js`:

Add to imports:

```js
import { FaStar, FaRegStar } from 'react-icons/fa';
```

Add the parameters `isFavorite = false` and `onToggleFavorite` to the destructured argument list of `createCollectionMenuItems`, then insert this item into the returned array between the `duplicate` and `copy-urls` items:

```js
    {
        id: 'favorite',
        text: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        icon: isFavorite ? <FaStar size={ICON_SIZE} /> : <FaRegStar size={ICON_SIZE} />,
        action: onToggleFavorite,
        className: '',
        condition: typeof onToggleFavorite === 'function'
    },
```

- [ ] **Step 4: Implement `_handleToggleFavorite`**

In `app/useCollectionOperations.js`:

Add to imports:

```js
import { getNextFavoriteOrder } from './utils/favoritesUtils';
```

Inside `useCollectionOperations`, add this function (place it after `_handleDuplicate`):

```js
    const _handleToggleFavorite = async () => {
        if (collection.isFavorite === true) {
            await updateCollection({ ...collection, isFavorite: false, favoriteOrder: null });
        } else {
            const favoriteOrder = await getNextFavoriteOrder();
            await updateCollection({ ...collection, isFavorite: true, favoriteOrder });
        }
    };
```

Add `_handleToggleFavorite` to the hook's returned object.

Note: `updateCollection` (App.js:745) calls `saveSingleCollection(newCollection, true)` which force-bumps `lastUpdated` — same behavior as a color change, and it guarantees the change wins in Drive sync.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test tests/contextMenuItems.favorite.test.js && yarn test tests/ContextMenu.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/useCollectionOperations.js app/utils/contextMenuItems.js tests/contextMenuItems.favorite.test.js
git commit -m "feat(favorites): add favorite toggle operation and context menu entry"
```

---

### Task 4: Star buttons on popup rows, popup tiles, and full-page cards

**Files:**
- Modify: `app/CollectionListItem.js` (star button in `right_items`, menu wiring)
- Modify: `app/CollectionList.css` (`.favorite-toggle` styles — CollectionListItem has no co-located CSS file; its styles live here)
- Modify: `app/CollectionTile.js` (star button in `tile-title-row`, menu wiring)
- Modify: `app/CollectionTile.css` (tile star styles)
- Modify: `app/fullpage/FPCollectionCard.js` (hover action, menu wiring, context-menu ops)
- Modify: `app/fullpage/FPCollectionCard.css` (favorited hover-action color)
- Modify: `app/fullpage/FPContentArea.js:3423` (right-click context menu entry, after the Duplicate button)
- Test: extend `tests/CollectionListItem.test.js`, `tests/CollectionTile.test.js`, `tests/FPCollectionCard.test.js`

- [ ] **Step 1: Write the failing tests**

In each of the three test files, the existing `mockCollectionHandlers` object (returned by the mocked `useCollectionOperations`) must gain `_handleToggleFavorite: jest.fn()`. Then add to each file a describe block (adapt `renderTile` to that file's existing render helper name — `tests/CollectionTile.test.js` uses `renderTile`, check the other two files for theirs):

```js
describe('favorite toggle', () => {
    it('renders an outline star and calls toggle on click', () => {
        renderTile();
        const starButton = screen.getByRole('button', { name: 'Add to favorites' });
        fireEvent.click(starButton);
        expect(mockCollectionHandlers._handleToggleFavorite).toHaveBeenCalledTimes(1);
    });

    it('renders a filled star for a favorited collection', () => {
        renderTile({ collection: { ...baseCollection, isFavorite: true } });
        expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument();
    });
});
```

(`tests/FPCollectionCard.test.js` renders `FPCollectionCard` directly — pass `collection={{ ...baseCollection, isFavorite: true }}` through whatever prop helper that file uses.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/CollectionListItem.test.js tests/CollectionTile.test.js tests/FPCollectionCard.test.js`
Expected: FAIL — no button named "Add to favorites".

- [ ] **Step 3: Implement in `CollectionListItem.js`**

Add to imports (line 3 already imports from `react-icons/fa`):

```js
import { FaPlay, FaStar, FaRegStar } from 'react-icons/fa';
```

Destructure `_handleToggleFavorite` from the `useCollectionOperations(...)` result (line 42-49 block).

In the `right_items` column (line 342), insert BEFORE the `open-tabs-icon` button:

```jsx
                <button
                    className={`favorite-toggle ${props.collection.isFavorite ? 'is-favorite' : ''}`}
                    aria-label={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    data-tooltip-id="main-tooltip"
                    data-tooltip-content={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={async (e) => {
                        e.stopPropagation();
                        await _handleToggleFavorite();
                    }}
                >
                    {props.collection.isFavorite ? <FaStar size={12} /> : <FaRegStar size={12} />}
                </button>
```

In the `createCollectionMenuItems({...})` call (line 360), add:

```js
                        isFavorite: props.collection.isFavorite === true,
                        onToggleFavorite: _handleToggleFavorite,
```

Add to `app/CollectionList.css`:

```css
/* Favorite star toggle (list rows + shared) */
.favorite-toggle {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px;
    color: var(--text-color);
    opacity: 0.45;
}

.favorite-toggle:hover {
    opacity: 1;
}

.favorite-toggle.is-favorite {
    color: #f4b400;
    opacity: 1;
}
```

- [ ] **Step 4: Implement in `CollectionTile.js`**

Add to imports:

```js
import { FaTrash, FaStar, FaRegStar } from 'react-icons/fa';
```

Destructure `_handleToggleFavorite` from `useCollectionOperations(...)` (line 39-45 block).

In the `tile-title-row` div (line 216), insert AFTER the `<h3 className="tile-title">` element (before the incognito indicator):

```jsx
                    <button
                        className={`favorite-toggle tile-favorite-toggle ${props.collection.isFavorite ? 'is-favorite' : ''}`}
                        aria-label={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        data-tooltip-id="main-tooltip"
                        data-tooltip-content={props.collection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={async (e) => {
                            e.stopPropagation();
                            await _handleToggleFavorite();
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {props.collection.isFavorite ? <FaStar size={12} /> : <FaRegStar size={12} />}
                    </button>
```

(`onPointerDown` stopPropagation is required — the whole tile carries the drag listeners.)

In the `createCollectionMenuItems({...})` call (line 300), add:

```js
                            isFavorite: props.collection.isFavorite === true,
                            onToggleFavorite: _handleToggleFavorite,
```

Add to `app/CollectionTile.css`:

```css
.tile-favorite-toggle {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px;
    color: var(--text-color);
    opacity: 0;
    flex-shrink: 0;
}

.collection-tile:hover .tile-favorite-toggle {
    opacity: 0.5;
}

.tile-favorite-toggle:hover {
    opacity: 1 !important;
}

.tile-favorite-toggle.is-favorite {
    color: #f4b400;
    opacity: 1 !important;
}
```

- [ ] **Step 5: Implement in `FPCollectionCard.js`**

Add to imports:

```js
import { FaTrash, FaStar, FaRegStar } from 'react-icons/fa';
```

Destructure `_handleToggleFavorite` from `useCollectionOperations(...)` (line 60-77 block).

In `handleContextMenu` (line 99), add `_handleToggleFavorite,` to the operations object passed to `onCardContextMenu`.

In the `createCollectionMenuItems({...})` call inside `actionMenu` (line 183), add:

```js
                isFavorite: collection.isFavorite === true,
                onToggleFavorite: _handleToggleFavorite,
```

In the `FPCardHoverActions` items array (line 199), insert between the `update` and `more` items:

```js
                {
                    key: 'favorite',
                    className: `fp-card-rail-favorite${collection.isFavorite ? ' is-favorite' : ''}`,
                    label: collection.isFavorite ? 'Unfavorite' : 'Favorite',
                    tooltip: collection.isFavorite ? 'Remove from favorites' : 'Add to favorites',
                    ariaLabel: collection.isFavorite ? 'Remove from favorites' : 'Add to favorites',
                    icon: collection.isFavorite ? <FaStar size={12} /> : <FaRegStar size={12} />,
                    onClick: _handleToggleFavorite,
                },
```

Add to `app/fullpage/FPCollectionCard.css`:

```css
.fp-card-rail-favorite.is-favorite {
    color: #f4b400;
}
```

- [ ] **Step 6: Add the entry to the full-page right-click menu**

In `app/fullpage/FPContentArea.js`:

Add `FaStar, FaRegStar` to the existing `react-icons/fa` import (the file already imports `FaPlay` and `FaStop` — extend that import line).

After the "Duplicate Collection" button (line 3417-3423) and before the "Copy all URLs" button, insert:

```jsx
                    <button
                        className="fp-card-ctx-item"
                        onClick={() => handleCtxMenuAction(cardCtxMenu.operations._handleToggleFavorite)}
                    >
                        {cardCtxMenu.collection.isFavorite ? <FaStar size={14} /> : <FaRegStar size={14} />}
                        <span>{cardCtxMenu.collection.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                    </button>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn test tests/CollectionListItem.test.js tests/CollectionTile.test.js tests/FPCollectionCard.test.js tests/FPContentArea.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/CollectionListItem.js app/CollectionList.css app/CollectionTile.js app/CollectionTile.css app/fullpage/FPCollectionCard.js app/fullpage/FPCollectionCard.css app/fullpage/FPContentArea.js tests/CollectionListItem.test.js tests/CollectionTile.test.js tests/FPCollectionCard.test.js
git commit -m "feat(favorites): add star toggle to collection rows, tiles, and full-page cards"
```

---

### Task 5: Popup Favorites section

**Files:**
- Create: `app/FavoritesSection.js`
- Create: `app/FavoritesSection.css`
- Modify: `app/CollectionList.js` (render the section above the main DnD content)
- Test: `tests/FavoritesSection.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/FavoritesSection.test.js`:

```js
/** @jest-environment jsdom */
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FavoritesSection from '../app/FavoritesSection';
import { renderWithProviders } from './helpers/renderWithProviders';

jest.mock('../app/CollapsableSection', () => function MockCollapsableSection({ sectionTitle, count, children }) {
    return (
        <div data-testid="collapsable-section">
            <span>{`${sectionTitle} (${count})`}</span>
            {children}
        </div>
    );
});

jest.mock('../app/SortableCollectionItem', () => function MockSortableItem({ collection }) {
    return <div data-testid="fav-item">{collection.name}</div>;
});

jest.mock('../app/SortableCollectionTile', () => function MockSortableTile({ collection }) {
    return <div data-testid="fav-tile">{collection.name}</div>;
});

jest.mock('../app/CollectionTile', () => function MockCollectionTile() {
    return null;
});

jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) } } },
}));

const collections = [
    { uid: 'a', name: 'Alpha', isFavorite: true, favoriteOrder: 1 },
    { uid: 'b', name: 'Beta', isFavorite: false },
    { uid: 'c', name: 'Gamma', isFavorite: true, favoriteOrder: 0 },
];

const noop = () => {};
const baseProps = {
    updateCollection: noop,
    removeCollection: noop,
    updateRemoteData: noop,
    addCollection: noop,
    onDataUpdate: noop,
    onSelect: noop,
};

describe('FavoritesSection', () => {
    it('renders only favorited collections sorted by favoriteOrder (list view)', () => {
        renderWithProviders(<FavoritesSection collections={collections} viewMode="list" {...baseProps} />);
        const items = screen.getAllByTestId('fav-item');
        expect(items.map((el) => el.textContent)).toEqual(['Gamma', 'Alpha']);
        expect(screen.getByText('Favorites (2)')).toBeInTheDocument();
    });

    it('renders tiles in grid view', () => {
        renderWithProviders(<FavoritesSection collections={collections} viewMode="grid" {...baseProps} />);
        expect(screen.getAllByTestId('fav-tile')).toHaveLength(2);
    });

    it('shows the empty hint when nothing is favorited', () => {
        renderWithProviders(<FavoritesSection collections={[{ uid: 'b', name: 'Beta' }]} viewMode="list" {...baseProps} />);
        expect(screen.getByText('Star a collection to pin it here')).toBeInTheDocument();
        expect(screen.getByText('Favorites (0)')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/FavoritesSection.test.js`
Expected: FAIL — module `app/FavoritesSection.js` not found.

- [ ] **Step 3: Create `app/FavoritesSection.js`**

```jsx
import React, { useMemo, useState } from 'react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import CollapsableSection from './CollapsableSection';
import SortableCollectionItem from './SortableCollectionItem';
import SortableCollectionTile from './SortableCollectionTile';
import CollectionTile from './CollectionTile';
import { getFavoriteCollections, buildFavoritesReorderUpdate } from './utils/favoritesUtils';
import { dndPointerSensorOptions } from './utils/dndShared';
import './FavoritesSection.css';

// Sortable IDs are namespaced because the same collection also renders (with its
// bare uid) in the main list below; dnd-kit and React both need unique IDs.
export const FAVORITE_SORTABLE_PREFIX = 'fav:';

function FavoritesSection({
    collections = [],
    viewMode,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    onSelect,
}) {
    const favorites = useMemo(() => getFavoriteCollections(collections), [collections]);
    const [activeFavorite, setActiveFavorite] = useState(null);
    const sensors = useSensors(useSensor(PointerSensor, dndPointerSensorOptions));
    const sortableIds = useMemo(
        () => favorites.map((collection) => `${FAVORITE_SORTABLE_PREFIX}${collection.uid}`),
        [favorites],
    );

    const handleDragStart = (event) => {
        const uid = String(event.active.id).slice(FAVORITE_SORTABLE_PREFIX.length);
        setActiveFavorite(favorites.find((collection) => collection.uid === uid) || null);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveFavorite(null);
        if (!over || active.id === over.id) return;
        const oldIndex = sortableIds.indexOf(active.id);
        const newIndex = sortableIds.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(favorites, oldIndex, newIndex);
        // Single batch write via updateRemoteData -> batchUpdateCollections
        await updateRemoteData(buildFavoritesReorderUpdate(collections, reordered));
    };

    const itemProps = (collection, index) => ({
        id: `${FAVORITE_SORTABLE_PREFIX}${collection.uid}`,
        collection,
        index,
        activeId: activeFavorite?.uid,
        updateCollection,
        removeCollection,
        updateRemoteData,
        addCollection,
        onDataUpdate,
        isInFolder: false,
        onSelect,
    });

    return (
        <CollapsableSection
            sectionKey="favoritesCollapsed"
            sectionTitle="Favorites"
            count={favorites.length}
            expandTooltip="Expand favorites section"
            collapseTooltip="Collapse favorites section"
            className="favorites-section-header"
        >
            {favorites.length === 0 ? (
                <div className="favorites-empty-hint">Star a collection to pin it here</div>
            ) : (
                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <SortableContext
                        items={sortableIds}
                        strategy={viewMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
                    >
                        <div className={viewMode === 'grid' ? 'collections-section-grid' : 'collections-section-list'}>
                            {favorites.map((collection, index) => (
                                viewMode === 'grid' ? (
                                    <SortableCollectionTile key={`fav-${collection.uid}`} {...itemProps(collection, index)} />
                                ) : (
                                    <SortableCollectionItem key={`fav-${collection.uid}`} {...itemProps(collection, index)} />
                                )
                            ))}
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeFavorite ? (
                            viewMode === 'grid' ? (
                                <CollectionTile
                                    collection={activeFavorite}
                                    index={-1}
                                    activeId={activeFavorite.uid}
                                    updateCollection={updateCollection}
                                    removeCollection={removeCollection}
                                    updateRemoteData={updateRemoteData}
                                />
                            ) : (
                                <SortableCollectionItem
                                    id={`${FAVORITE_SORTABLE_PREFIX}${activeFavorite.uid}-overlay`}
                                    collection={activeFavorite}
                                    index={-1}
                                    activeId={activeFavorite.uid}
                                    updateCollection={updateCollection}
                                    removeCollection={removeCollection}
                                    updateRemoteData={updateRemoteData}
                                />
                            )
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}
        </CollapsableSection>
    );
}

export default FavoritesSection;
```

- [ ] **Step 4: Create `app/FavoritesSection.css`**

```css
.favorites-empty-hint {
    padding: 10px 14px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-color);
    opacity: 0.55;
}
```

- [ ] **Step 5: Render it in `app/CollectionList.js`**

Add the import:

```js
import FavoritesSection from './FavoritesSection';
```

In the returned JSX, directly after `{search ? <SearchTitle searchTerm={search} /> : null}` (line 894) and before the `{hasAnyContent ? (` block, insert:

```jsx
            {/* Favorites: topmost section; hidden during search (search results
                already include favorited collections, matching how the Folders
                section is hidden in search mode) */}
            {!search?.trim() && (
                <FavoritesSection
                    collections={collections}
                    viewMode={props.viewMode}
                    updateCollection={props.updateCollection}
                    removeCollection={props.removeCollection}
                    updateRemoteData={props.updateRemoteData}
                    addCollection={addCollection}
                    onDataUpdate={props.onDataUpdate}
                    onSelect={handleSelectCollection}
                />
            )}
```

This is a sibling of the main `DndContext`, so the two drag contexts never nest and the existing collision detection is untouched. Cross-section drag is impossible by construction.

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn test tests/FavoritesSection.test.js tests/CollectionList.test.js tests/CollectionList.rendering.test.js tests/CollectionList.reorder.test.js`
Expected: PASS. If a CollectionList rendering test fails because of the new section, mock `../app/FavoritesSection` in that test file with `jest.mock('../app/FavoritesSection', () => function MockFavoritesSection() { return null; });`.

- [ ] **Step 7: Commit**

```bash
git add app/FavoritesSection.js app/FavoritesSection.css app/CollectionList.js tests/FavoritesSection.test.js
git commit -m "feat(favorites): add Favorites section to popup view"
```

---

### Task 6: Full-page Favorites section

**Files:**
- Create: `app/fullpage/FPFavoritesSection.js`
- Create: `app/fullpage/FPFavoritesSection.css`
- Modify: `app/fullpage/FPContentArea.js` (render above the main DndContext)
- Test: `tests/FPFavoritesSection.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/FPFavoritesSection.test.js`:

```js
/** @jest-environment jsdom */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPFavoritesSection from '../app/fullpage/FPFavoritesSection';
import { renderWithProviders } from './helpers/renderWithProviders';

jest.mock('../app/fullpage/FPCollectionCard', () => function MockFPCollectionCard({ collection }) {
    return <div data-testid="fav-card">{collection.name}</div>;
});

const mockStorageGet = jest.fn(async () => ({}));
const mockStorageSet = jest.fn(async () => {});
jest.mock('../static/globals', () => ({
    browser: {
        storage: {
            local: {
                get: (...args) => mockStorageGet(...args),
                set: (...args) => mockStorageSet(...args),
            },
        },
    },
}));

const collections = [
    { uid: 'a', name: 'Alpha', isFavorite: true, favoriteOrder: 1 },
    { uid: 'b', name: 'Beta' },
    { uid: 'c', name: 'Gamma', isFavorite: true, favoriteOrder: 0 },
];

const noop = () => {};
const baseProps = {
    viewMode: 'grid',
    updateCollection: noop,
    removeCollection: noop,
    updateRemoteData: noop,
    addCollection: noop,
    onDataUpdate: noop,
    onSelect: noop,
};

describe('FPFavoritesSection', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders favorites sorted by favoriteOrder', () => {
        renderWithProviders(<FPFavoritesSection collections={collections} {...baseProps} />);
        const cards = screen.getAllByTestId('fav-card');
        expect(cards.map((el) => el.textContent)).toEqual(['Gamma', 'Alpha']);
    });

    it('shows the empty hint when nothing is favorited', () => {
        renderWithProviders(<FPFavoritesSection collections={[{ uid: 'b', name: 'Beta' }]} {...baseProps} />);
        expect(screen.getByText('Star a collection to pin it here')).toBeInTheDocument();
    });

    it('collapses on header click and persists the state', async () => {
        renderWithProviders(<FPFavoritesSection collections={collections} {...baseProps} />);
        fireEvent.click(screen.getByText('Favorites'));
        await waitFor(() => {
            expect(screen.queryAllByTestId('fav-card')).toHaveLength(0);
        });
        expect(mockStorageSet).toHaveBeenCalledWith({ fpFavoritesCollapsed: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/FPFavoritesSection.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/fullpage/FPFavoritesSection.js`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaStar } from 'react-icons/fa';
import { MdExpandMore, MdExpandLess } from 'react-icons/md';
import FPCollectionCard from './FPCollectionCard';
import { getFavoriteCollections, buildFavoritesReorderUpdate } from '../utils/favoritesUtils';
import { dndPointerSensorOptions } from '../utils/dndShared';
import { browser } from '../../static/globals';
import './FPFavoritesSection.css';

export const FP_FAVORITE_SORTABLE_PREFIX = 'fav:';

function SortableFavoriteCard({ id, collection, viewMode, cardProps }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
    };

    return (
        <div ref={setNodeRef} style={style}>
            <FPCollectionCard
                {...cardProps}
                collection={collection}
                viewMode={viewMode}
                dragAttributes={attributes}
                dragListeners={listeners}
                enableDropZone={false}
            />
        </div>
    );
}

function FPFavoritesSection({
    collections = [],
    viewMode,
    updateCollection,
    removeCollection,
    updateRemoteData,
    addCollection,
    onDataUpdate,
    onSelect,
    onCardContextMenu,
    trackedCollectionUids,
}) {
    const favorites = useMemo(() => getFavoriteCollections(collections), [collections]);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, dndPointerSensorOptions));
    const sortableIds = useMemo(
        () => favorites.map((collection) => `${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`),
        [favorites],
    );

    useEffect(() => {
        let mounted = true;
        browser.storage.local.get(['fpFavoritesCollapsed'])
            .then((result) => {
                if (mounted) setIsCollapsed(result.fpFavoritesCollapsed || false);
            })
            .catch(() => {});
        return () => { mounted = false; };
    }, []);

    const toggleCollapsed = () => {
        const next = !isCollapsed;
        setIsCollapsed(next);
        browser.storage.local.set({ fpFavoritesCollapsed: next }).catch(() => {});
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = sortableIds.indexOf(active.id);
        const newIndex = sortableIds.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(favorites, oldIndex, newIndex);
        await updateRemoteData(buildFavoritesReorderUpdate(collections, reordered));
    };

    const cardProps = {
        onSelect,
        updateCollection,
        removeCollection,
        updateRemoteData,
        addCollection,
        onDataUpdate,
        onCardContextMenu,
    };

    return (
        <section className="fp-favorites-section">
            <div
                className="fp-favorites-header"
                onClick={toggleCollapsed}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleCollapsed();
                    }
                }}
                aria-expanded={!isCollapsed}
                data-tooltip-id="main-tooltip"
                data-tooltip-content={isCollapsed ? 'Expand favorites' : 'Collapse favorites'}
            >
                <FaStar size={13} className="fp-favorites-header-star" />
                <span className="fp-favorites-title">Favorites</span>
                <span className="fp-favorites-count">({favorites.length})</span>
                {isCollapsed ? <MdExpandMore size={18} /> : <MdExpandLess size={18} />}
            </div>
            {!isCollapsed && (
                favorites.length === 0 ? (
                    <div className="fp-favorites-empty-hint">Star a collection to pin it here</div>
                ) : (
                    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                        <SortableContext
                            items={sortableIds}
                            strategy={viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
                        >
                            <div className={`fp-favorites-items${viewMode === 'list' ? ' fp-content-list-mode' : ''}`}>
                                {favorites.map((collection) => (
                                    <SortableFavoriteCard
                                        key={`fav-${collection.uid}`}
                                        id={`${FP_FAVORITE_SORTABLE_PREFIX}${collection.uid}`}
                                        collection={collection}
                                        viewMode={viewMode}
                                        cardProps={{
                                            ...cardProps,
                                            isAutoUpdate: trackedCollectionUids?.has(collection.uid) === true,
                                        }}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )
            )}
        </section>
    );
}

export default FPFavoritesSection;
```

- [ ] **Step 4: Create `app/fullpage/FPFavoritesSection.css`**

```css
.fp-favorites-section {
    margin-bottom: 18px;
}

.fp-favorites-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    cursor: pointer;
    user-select: none;
    color: var(--text-color);
}

.fp-favorites-header-star {
    color: #f4b400;
}

.fp-favorites-title {
    font-size: 14px;
    font-weight: 600;
}

.fp-favorites-count {
    font-size: 12px;
    opacity: 0.6;
}

.fp-favorites-items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    padding: 6px 0 2px;
}

.fp-favorites-items.fp-content-list-mode {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.fp-favorites-empty-hint {
    padding: 8px 4px 12px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-color);
    opacity: 0.55;
}
```

(After implementation, compare the grid column sizing with `.fp-content-grid` in the existing full-page CSS and match its `minmax` value so favorite cards are the same width as the cards below.)

- [ ] **Step 5: Render it in `app/fullpage/FPContentArea.js`**

Add the import:

```js
import FPFavoritesSection from './FPFavoritesSection';
```

Inside the `fp-content-grid` div (line 3205-3208), immediately BEFORE `{hasRenderableCollections ? (` (line 3209), insert:

```jsx
                    {shouldRenderGroupedAllCollections && (
                        <FPFavoritesSection
                            collections={collections}
                            viewMode={viewMode}
                            updateCollection={updateCollection}
                            removeCollection={removeCollection}
                            updateRemoteData={updateRemoteData}
                            addCollection={addCollection}
                            onDataUpdate={onDataUpdate}
                            onSelect={handleSelectCollection}
                            onCardContextMenu={hasSelectedCollections ? undefined : handleCardContextMenu}
                            trackedCollectionUids={trackedCollectionUids}
                        />
                    )}
```

`shouldRenderGroupedAllCollections` (line 874) is `sidebarNavigation === 'all' && !hasActiveFilters && !hasSearchQuery` — so Favorites shows in the main "all collections" browsing view and hides during search, active filters, and folder/recent/unorganized sidebar views (where a second copy of the list would be confusing).

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn test tests/FPFavoritesSection.test.js tests/FPContentArea.test.js tests/FPContentArea.reorder.test.js`
Expected: PASS. If an FPContentArea test fails due to the new section, mock `../app/fullpage/FPFavoritesSection` in it with a null component (same pattern as Task 5 Step 6).

- [ ] **Step 7: Commit**

```bash
git add app/fullpage/FPFavoritesSection.js app/fullpage/FPFavoritesSection.css app/fullpage/FPContentArea.js tests/FPFavoritesSection.test.js
git commit -m "feat(favorites): add Favorites section to full page view"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run lint**

Run: `yarn lint`
Expected: 0 errors. Fix any unused-import or react-hooks warnings introduced by the feature.

- [ ] **Step 2: Run the full test suite**

Run: `yarn test`
Expected: all suites PASS.

- [ ] **Step 3: Run the required production build**

Run: `yarn prod`
Expected: webpack completes with exit code 0 (CLAUDE.md requires this before the work is considered complete).

- [ ] **Step 4: Manual smoke test (if a browser is available)**

Load `build/` as an unpacked extension and verify: star toggle on a row adds the collection to a Favorites section at the top; the collection still appears in its folder; un-starring from inside Favorites removes it; reordering two favorites by drag persists after closing/reopening the popup; the full-page "All collections" view shows the same section; search hides the section.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore(favorites): lint/test/build fixes for favorites feature"
```

(Skip the commit if Steps 1-3 produced no changes.)

---

## Out of Scope (do NOT implement)

- Dragging collections into/out of the Favorites section to toggle favorite status (the star is the only toggle).
- Favoriting folders, a favorites-only view, or keyboard shortcuts.
- Copying favorite status when duplicating a collection (`_handleDuplicate` builds a fresh `TaboxCollection` without the fields — already correct).
- Storage version bump / migration — missing fields read as not-favorite by design.
