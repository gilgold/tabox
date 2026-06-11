# Favorites v2 Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Re-surface favorites per Revision 2 of the spec: full-page Favorites becomes a sidebar view (removed from "All Collections"); popup Favorites section is replaced by a star filter in the toolbar.

**Architecture:** Data model, star toggles, and `favoriteOrder` reorder machinery from v1 are untouched. `FPFavoritesSection` loses its collapsible header and becomes the standalone body of a new `'favorites'` sidebar view (its own DndContext keeps favoriteOrder reordering out of the parentId/order-based main drag engine). The popup filter rides the existing `filters` → `collectionsToShow` → `hasActiveFilters` pipeline in App.js — note collections reach both the popup list AND FPContentArea already search/filter-applied upstream.

**Spec:** `docs/superpowers/specs/2026-06-11-favorite-collections-design.md` (Revision 2 section)

---

### Task A: Popup — remove Favorites section, add star filter

**Files:**
- Delete: `app/FavoritesSection.js`, `app/FavoritesSection.css`, `tests/FavoritesSection.test.js`
- Modify: `app/CollectionList.js` (remove import + render block), `tests/CollectionList.test.js` (remove the FavoritesSection mock)
- Modify: `app/CollectionFilter.js`, `app/CollectionFilter.css`, `app/App.js`
- Test: extend `tests/CollectionFilter.test.js`

- [ ] **Step 1: Write the failing tests** — in `tests/CollectionFilter.test.js`, add (adapting to the file's existing render/onFiltersChange harness — read it first):

```js
describe('favorites filter', () => {
    it('emits favoritesOnly: true when the star is toggled on', () => {
        const onFiltersChange = jest.fn();
        render(<CollectionFilter onFiltersChange={onFiltersChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show only favorite collections' }));
        expect(onFiltersChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ favoritesOnly: true })
        );
    });

    it('clear-all resets the favorites filter', () => {
        const onFiltersChange = jest.fn();
        render(<CollectionFilter onFiltersChange={onFiltersChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show only favorite collections' }));
        fireEvent.click(document.getElementById('filter-clear'));
        expect(onFiltersChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ favoritesOnly: false })
        );
    });
});
```

- [ ] **Step 2:** Run `yarn test tests/CollectionFilter.test.js` — expect FAIL (no such button).

- [ ] **Step 3: Implement the filter in `app/CollectionFilter.js`:**

Change the md import to include the star icons:
```js
import { MdClear, MdPalette, MdOpenInBrowser, MdStar, MdStarBorder } from 'react-icons/md';
```

Add next to `RecentlyOpenedFilter`:
```jsx
function FavoritesFilter({ isActive, onToggle }) {
    return (
        <FilterTooltip content="Show only favorite collections" place="top">
            <button
                id="filter-favorites"
                type="button"
                className={`fp-toolbar-pill collection-filter-favorites ${isActive ? 'active' : ''}`}
                onClick={onToggle}
                aria-pressed={isActive}
                aria-label="Show only favorite collections"
            >
                {isActive ? <MdStar size={18} /> : <MdStarBorder size={18} />}
            </button>
        </FilterTooltip>
    );
}
```

In `CollectionFilter`: add `const [favoritesActive, setFavoritesActive] = useState(false);`; add `favoritesOnly: favoritesActive` to the `onFiltersChange` payload and `favoritesActive` to that effect's dependency array; add a `handleFavoritesToggle` mirroring `handleRecentlyOpenedToggle`; reset it in `handleClearAll`; include it in the local `hasActiveFilters`; render `<FavoritesFilter isActive={favoritesActive} onToggle={handleFavoritesToggle} />` BEFORE `<RecentlyOpenedFilter ...>` in the `collection-filter-group` div.

Append to `app/CollectionFilter.css`:
```css
.collection-filter-favorites.active {
    color: var(--favorite-star-color);
}
```

- [ ] **Step 4: Wire it in `app/App.js`:**
- Line ~69: `const DEFAULT_COLLECTION_FILTERS = { recentlyOpenedActual: false, colors: [], favoritesOnly: false };`
- In the `hasActiveFilters` memo (~line 1763): add `const hasFavoritesFilter = filters.favoritesOnly === true;` and include it in the returned `||` chain.
- In the `collectionsToShow` memo (~line 1770), after the recently-opened filter block:
```js
    // Apply favorites filter
    if (filters.favoritesOnly) {
      filteredCollections = filteredCollections.filter(collection => collection.isFavorite === true);
    }
```

- [ ] **Step 5: Remove the popup Favorites section:**
- In `app/CollectionList.js`: delete the `import FavoritesSection from './FavoritesSection';` line and the entire `{!search?.trim() && (<FavoritesSection .../>)}` block (including its comment).
- In `tests/CollectionList.test.js`: delete the `jest.mock('../app/FavoritesSection', ...)` lines.
- `git rm app/FavoritesSection.js app/FavoritesSection.css tests/FavoritesSection.test.js`

- [ ] **Step 6:** Run `yarn test tests/CollectionFilter.test.js tests/CollectionList.test.js tests/CollectionList.rendering.test.js`, then the FULL `yarn test` and `yarn lint`. Expected: PASS. If a CollectionList snapshot changed because the section is gone, update the snapshot (`yarn test tests/CollectionList.test.js -u`) and eyeball the diff.

- [ ] **Step 7: Commit:**
```bash
git add -A
git commit -m "feat(favorites)!: replace popup Favorites section with a star toolbar filter"
```

---

### Task B: Full page — Favorites sidebar view

**Files:**
- Modify: `app/fullpage/FPFavoritesSection.js` (strip header → standalone view body), `app/fullpage/FPFavoritesSection.css`
- Modify: `app/fullpage/FPSidebar.js` (nav item), `app/fullpage/FPContentArea.js` (remove from 'all', add view)
- Test: update `tests/FPFavoritesSection.test.js`, extend `tests/FPSidebar.test.js`

- [ ] **Step 1: Strip `FPFavoritesSection` to a standalone view body.** Remove the collapsible header, `isCollapsed` state, the `browser.storage.local` persistence effect, `toggleCollapsed`, and the now-unused imports (`useEffect`, `useState`, `FaStar`, `MdExpandMore`, `MdExpandLess`, `browser`). Add props `disableDrag = false` and `search`. `SortableFavoriteCard` gains a `disableDrag` prop → `useSortable({ id, disabled: disableDrag })`. Pass `search` through to each `FPCollectionCard` (it accepts a `search` prop for highlight). The component returns:

```jsx
    return (
        <section className="fp-favorites-section">
            {favorites.length === 0 ? (
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
                                    disableDrag={disableDrag}
                                    cardProps={{
                                        ...cardProps,
                                        search,
                                        isAutoUpdate: trackedCollectionUids?.has(collection.uid) === true,
                                    }}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </section>
    );
```

In `app/fullpage/FPFavoritesSection.css`: remove the now-dead `.fp-favorites-header`, `.fp-favorites-header-star`, `.fp-favorites-title`, `.fp-favorites-count` rules; keep `.fp-favorites-section`, `.fp-favorites-items`, list-mode, and empty-hint rules.

Update `tests/FPFavoritesSection.test.js`: delete the collapse test and the storage mocks it used; the sorted-render and empty-hint tests stay. Add one test that `disableDrag` renders without crashing (smoke).

- [ ] **Step 2: Sidebar item in `app/fullpage/FPSidebar.js`.** Add `MdStar` to the `react-icons/md` import. Below the existing `allCount`/`unorganizedCount` memos add:
```js
    const favoritesCount = useMemo(() => (
        collections.filter(c => c.isFavorite === true).length
    ), [collections]);
```
In the `navItems` array, insert after the `'all'` entry:
```js
    { key: 'favorites', label: 'Favorites', count: favoritesCount, icon: MdStar },
```

Add to `tests/FPSidebar.test.js` (adapting to its existing render harness):
```js
    it('shows a Favorites nav item with the favorited-collection count', () => {
        // render with collections where two have isFavorite: true
        // assert screen.getByText('Favorites') exists and its counter shows 2,
        // and clicking it sets sidebarNavigationState to 'favorites'
    });
```
Write that as a real test following the file's existing patterns for nav items (e.g. how the 'all' item count/selection is asserted) — no placeholder bodies.

- [ ] **Step 3: Wire the view in `app/fullpage/FPContentArea.js`:**
- Add import: `import { getFavoriteCollections } from '../utils/favoritesUtils';`
- Delete the `{shouldRenderGroupedAllCollections && (<FPFavoritesSection .../>)}` block from the `fp-content-grid` JSX (keep the FPFavoritesSection import — it's used below).
- Near `shouldRenderGroupedAllCollections` (~line 875): `const isFavoritesView = sidebarNavigation === 'favorites';`
- In the `filteredCollections` switch, add before `default:`:
```js
            case 'favorites':
                return getFavoriteCollections(sourceCollections);
```
- In `canReorderFlatCollections` (~line 880) add `sidebarNavigation !== 'favorites' &&` inside the second condition group (defensive — the main engine doesn't render this view, but keep its gates honest).
- In the `contentHeading` switch, add:
```js
        case 'favorites':
            return {
                badge: 'Library area',
                title: 'Favorites',
                subtitle: 'Collections you starred',
                countLabel: collectionCountLabel,
                accentColor: 'var(--favorite-star-color)',
            };
```
- In the `fp-content-grid` render block, change the body to render the favorites view in place of the main grid:
```jsx
                    {isFavoritesView ? (
                        <FPFavoritesSection
                            collections={collections}
                            viewMode={viewMode}
                            search={search}
                            disableDrag={hasSearchQuery || hasSelectedCollections}
                            updateCollection={updateCollection}
                            removeCollection={removeCollection}
                            updateRemoteData={updateRemoteData}
                            addCollection={addCollection}
                            onDataUpdate={onDataUpdate}
                            onSelect={handleSelectCollection}
                            onCardContextMenu={hasSelectedCollections ? undefined : handleCardContextMenu}
                            trackedCollectionUids={trackedCollectionUids}
                        />
                    ) : hasRenderableCollections ? (
                        <DndContext ...existing block unchanged...
                    ) : (
                        renderEmptyState()
                    )}
```
(Note: `collections` arrive already search/filter-applied from App.js upstream, so the favorites view participates in global search for free; `disableDrag` keeps favoriteOrder stable while a search narrows the list.)

- [ ] **Step 4:** Run `yarn test tests/FPFavoritesSection.test.js tests/FPSidebar.test.js tests/FPContentArea.test.js tests/FPContentArea.reorder.test.js`, then FULL `yarn test` and `yarn lint`. Update any FPContentArea test that asserted the old in-'all'-view favorites rendering.

- [ ] **Step 5: Commit:**
```bash
git add -A
git commit -m "feat(favorites)!: move full-page favorites into a dedicated sidebar view"
```

---

### Task C: Verification

- [ ] `yarn lint` → 0 errors
- [ ] `yarn test` → all green
- [ ] `yarn prod` → exit 0 (required by CLAUDE.md)
- [ ] Final review of the v2 diff against the Revision 2 spec section.

## Out of Scope
- Bulk-selection checkboxes inside the full-page Favorites view (main-grid only, as with the v1 section).
- Sorting favorites by the toolbar sort controls (Favorites view always orders by `favoriteOrder`).
