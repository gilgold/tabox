# Multi-Color Collection Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to filter collections by multiple colors at once (OR semantics), with a "Clear" action in the color popover and a gradient preview swatch for multi-selection, in both popup and full-page views.

**Architecture:** Replace the single `color` filter value with a `colors` array threaded through `App.js`, `CollectionFilter.js` (popup), and `FPContentArea.js` (full page). Add an opt-in `multiSelect` mode to the shared `ColorPicker` that toggles colors, stays open, checkmarks all selected colors, renders a Clear row, and shows a solid/gradient trigger preview. Single-select (collection color editing) stays unchanged.

**Tech Stack:** React 19, Jotai, Jest 29 + React Testing Library, plain CSS. Color helpers in `app/utils/colorMigration.js` (`COLOR_PALETTE`, `getColorValue`, `normalizeColorKey`).

---

## File Structure

- `app/ColorPicker.js` — add opt-in multi-select mode (props, toggle, multi-checkmarks, Clear row, gradient/solid trigger preview).
- `app/CollectionList.css` — style the new `.color-picker-clear-row` (color popover styles live here, lines ~865+).
- `app/CollectionFilter.js` — popup view: `selectedColor` → `selectedColors` array; toggle/clear; emit `colors`.
- `app/fullpage/FPContentArea.js` — full-page view: `colorFilter` → `colorsFilter` array; toggle/clear; emit `colors`.
- `app/App.js` — `DEFAULT_COLLECTION_FILTERS` and `collectionsToShow` color filtering use `colors` array.
- `tests/CollectionFilter.test.js` — extend with multi-select + clear coverage.
- `tests/multiColorFilter.test.js` — new: filter-logic helper unit tests.

---

### Task 1: Filter logic — `colors` array OR-match in App.js

**Files:**
- Modify: `app/App.js` (`DEFAULT_COLLECTION_FILTERS` ~line 66; `collectionsToShow` color block ~lines 1776-1780)
- Test: `tests/multiColorFilter.test.js` (create)

The color filtering predicate is currently inline in a `useMemo`. To test it in isolation, extract a pure helper and use it both in the test and in `App.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/multiColorFilter.test.js`:

```javascript
import { filterByColors } from '../app/utils/colorMigration';

const collections = [
  { uid: '1', color: 'red' },
  { uid: '2', color: 'blue' },
  { uid: '3', color: 'green' },
  { uid: '4', color: 'default' },
];

describe('filterByColors', () => {
  test('empty selection returns all collections', () => {
    expect(filterByColors(collections, [])).toHaveLength(4);
    expect(filterByColors(collections, undefined)).toHaveLength(4);
  });

  test('single color returns only matching collections', () => {
    const result = filterByColors(collections, ['red']);
    expect(result.map((c) => c.uid)).toEqual(['1']);
  });

  test('multiple colors return any matching collection (OR)', () => {
    const result = filterByColors(collections, ['red', 'blue']);
    expect(result.map((c) => c.uid)).toEqual(['1', '2']);
  });

  test('normalizes color keys when matching', () => {
    const legacy = [{ uid: 'x', color: '#DC2626' }];
    expect(filterByColors(legacy, ['red']).map((c) => c.uid)).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/multiColorFilter.test.js`
Expected: FAIL — `filterByColors is not a function`.

- [ ] **Step 3: Add the `filterByColors` helper**

Append to `app/utils/colorMigration.js` (after `normalizeColorKey`):

```javascript
/**
 * Filter collections by a set of selected color names (OR semantics).
 * Empty/undefined selection returns all collections unchanged.
 * @param {Array<{color?: string}>} collections
 * @param {Array<string>} colors selected color names
 * @returns {Array} filtered collections
 */
export const filterByColors = (collections, colors) => {
    if (!colors || colors.length === 0) return collections;
    const selected = new Set(colors.map(normalizeColorKey));
    return collections.filter((collection) => selected.has(normalizeColorKey(collection.color)));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/multiColorFilter.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire helper into App.js**

In `app/App.js`, change the default filters (~line 66):

```javascript
const DEFAULT_COLLECTION_FILTERS = { recentlyOpenedActual: false, colors: [] };
```

Add `filterByColors` to the existing `colorMigration` import (it already imports `normalizeColorKey` — add `filterByColors` to that import statement).

Replace the color filter block in `collectionsToShow` (~lines 1775-1780):

```javascript
    // Apply color filter (multi-select, OR semantics)
    filteredCollections = filterByColors(filteredCollections, filters.colors);
```

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `yarn test`
Expected: PASS. (Existing tests that pass a single `color` filter, if any, may need updating — if a test fails referencing `filters.color`, update it to `colors: [name]`.)

- [ ] **Step 7: Commit**

```bash
git add app/utils/colorMigration.js app/App.js tests/multiColorFilter.test.js
git commit -m "feat: multi-color filter logic with OR semantics"
```

---

### Task 2: ColorPicker — opt-in multi-select mode

**Files:**
- Modify: `app/ColorPicker.js`
- Modify: `app/CollectionList.css` (color popover styles ~lines 865+)
- Test: `tests/CollectionFilter.test.js` (extend; popup wires multiSelect in Task 3 — for this task, test ColorPicker directly)

ColorPicker must remain backward-compatible: single-select editing closes on pick and shows one checkmark. Add `multiSelect`, `selectedColors`, `onClear`.

- [ ] **Step 1: Write the failing test**

Add to `tests/CollectionFilter.test.js` a new describe block. It renders `ColorPicker` directly:

```javascript
import ColorPicker from '../app/ColorPicker';

describe('ColorPicker multi-select mode', () => {
  test('checkmarks every selected color and stays open after a pick', () => {
    const action = jest.fn();
    const { container } = render(
      <ColorPicker
        multiSelect
        selectedColors={['red', 'blue']}
        action={action}
        onClear={jest.fn()}
        size="small"
      />
    );

    fireEvent.click(container.querySelector('.modern-color-picker'));

    const selected = container.querySelectorAll('.modern-color-option.selected');
    expect(selected.length).toBe(2);

    // picking a color toggles via action and the popover stays open
    fireEvent.click(container.querySelector('.modern-color-option'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.color-grid')).toBeInTheDocument();
  });

  test('Clear row calls onClear and is disabled when nothing selected', () => {
    const onClear = jest.fn();
    const { container } = render(
      <ColorPicker multiSelect selectedColors={[]} action={jest.fn()} onClear={onClear} size="small" />
    );
    fireEvent.click(container.querySelector('.modern-color-picker'));

    const clearBtn = container.querySelector('.color-picker-clear-row');
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).toBeDisabled();
    fireEvent.click(clearBtn);
    expect(onClear).not.toHaveBeenCalled();
  });

  test('trigger preview is a gradient when 2+ colors selected', () => {
    const { container } = render(
      <ColorPicker multiSelect selectedColors={['red', 'blue']} action={jest.fn()} onClear={jest.fn()} size="small" />
    );
    const preview = container.querySelector('.current-color-preview');
    expect(preview.getAttribute('style')).toMatch(/linear-gradient/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/CollectionFilter.test.js -t "multi-select"`
Expected: FAIL — selected count is not 2 (only one checkmark), no `.color-picker-clear-row`, no gradient.

- [ ] **Step 3: Implement multi-select in ColorPicker.js**

In `app/ColorPicker.js`:

a) Read new props near the top of the component:

```javascript
    const multiSelect = props.multiSelect === true;
    const selectedColors = props.selectedColors ?? [];
```

b) Compute the trigger preview background. Add `getColorValue` to the existing import from `./utils/colorMigration` (currently imports `COLOR_PALETTE`). Then add, before the `return`:

```javascript
    const triggerBackground = (() => {
        if (!multiSelect) return color;
        if (selectedColors.length === 0) return 'var(--collection-default-color)';
        if (selectedColors.length === 1) return getColorValue(selectedColors[0]);
        const stops = selectedColors.map((name, i) => {
            const pct = Math.round((i / (selectedColors.length - 1)) * 100);
            return `${getColorValue(name)} ${pct}%`;
        });
        return `linear-gradient(135deg, ${stops.join(', ')})`;
    })();
```

c) In `handleChange`, do not close the popover in multi-select mode:

```javascript
    const handleChange = async (colorName, colorValue, index, e) => {
        e.stopPropagation();
        props.action(colorName, props.group ?? null);
        if (!multiSelect) {
            setColor(colorValue);
            setSelectedColorCircle(index);
            setShowPicker(false);
            props.onOpenChange?.(false);
        }
    };
```

d) In the swatch `className`, mark selected for multi-select using membership:

```javascript
                            className={`modern-color-option ${
                                multiSelect
                                    ? (selectedColors.includes(colorName) ? 'selected' : '')
                                    : (index === selectedColorCircle ? 'selected' : '')
                            }`}
```

e) In the checkmark render condition, use the same membership test:

```javascript
                            {(multiSelect ? selectedColors.includes(colorName) : index === selectedColorCircle) && (
                                <div className="selection-indicator">
```

f) After the `.color-grid` div (inside `.modern-color-popover`, before its closing `</div>`), add the Clear row only in multi-select:

```javascript
                {multiSelect && (
                    <button
                        type="button"
                        className="color-picker-clear-row"
                        disabled={selectedColors.length === 0}
                        onClick={(e) => { e.stopPropagation(); props.onClear?.(); }}
                    >
                        Clear
                    </button>
                )}
```

g) Use `triggerBackground` for the preview circle:

```javascript
                <div className="current-color-preview" style={{ background: triggerBackground }} />
```

- [ ] **Step 4: Add Clear row CSS**

In `app/CollectionList.css`, after the `.modern-color-option.selected` rule (~line 923 area, within the popover styles), add:

```css
.color-picker-clear-row {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 6px 8px;
    border: none;
    border-top: 1px solid var(--setting-row-border-color);
    background: none;
    color: var(--text-color, inherit);
    font-size: 12px;
    text-align: center;
    cursor: pointer;
    border-radius: 6px;
}

.color-picker-clear-row:hover:not(:disabled) {
    background: var(--button-hover-bg, rgba(0, 0, 0, 0.06));
}

.color-picker-clear-row:disabled {
    opacity: 0.4;
    cursor: default;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test tests/CollectionFilter.test.js`
Expected: PASS — including the new multi-select block and the pre-existing single-select tests (unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add app/ColorPicker.js app/CollectionList.css tests/CollectionFilter.test.js
git commit -m "feat: add multi-select mode to ColorPicker with clear and gradient preview"
```

---

### Task 3: Popup view — CollectionFilter.js multi-color

**Files:**
- Modify: `app/CollectionFilter.js`
- Test: `tests/CollectionFilter.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/CollectionFilter.test.js`:

```javascript
describe('CollectionFilter multi-color', () => {
  test('selecting two colors emits both; clear empties the selection', async () => {
    const onFiltersChange = jest.fn();
    const { container } = render(<CollectionFilter onFiltersChange={onFiltersChange} />);

    fireEvent.click(container.querySelector('.modern-color-picker'));
    const options = container.querySelectorAll('.modern-color-option');

    // pick first two non-default colors
    fireEvent.click(options[1]);
    fireEvent.click(options[2]);

    await waitFor(() => {
      const last = onFiltersChange.mock.calls.at(-1)[0];
      expect(last.colors).toHaveLength(2);
    });

    // clear
    fireEvent.click(container.querySelector('.color-picker-clear-row'));
    await waitFor(() => {
      const last = onFiltersChange.mock.calls.at(-1)[0];
      expect(last.colors).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/CollectionFilter.test.js -t "multi-color"`
Expected: FAIL — emitted payload has `color` not `colors`; no clear row wired.

- [ ] **Step 3: Convert CollectionFilter to colors array**

In `app/CollectionFilter.js`:

`ColorFilter` component — replace single-select wiring:

```javascript
function ColorFilter({ selectedColors, onToggleColor, onClear }) {
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

    return (
        <div className="fp-toolbar-color-picker" id="filter-color-picker">
            <MdPalette size={18} className="fp-toolbar-color-icon" />
            <FilterTooltip
                content="Filter collections by color"
                place="bottom"
                disabled={isColorPickerOpen}
            >
                <ColorPicker
                    multiSelect
                    selectedColors={selectedColors}
                    action={onToggleColor}
                    onClear={onClear}
                    size="small"
                    showTriggerTooltip={false}
                    showOptionTooltips={false}
                    onOpenChange={setIsColorPickerOpen}
                />
            </FilterTooltip>
        </div>
    );
}
```

`CollectionFilter` component — state and handlers:

```javascript
    const [selectedColors, setSelectedColors] = useState([]);
```

(replace `const [selectedColor, setSelectedColor] = useState(null);`)

Emit effect payload — change `color: selectedColor` to `colors: selectedColors`, and dependency `[recentlyOpenedActive, selectedColor]` to `[recentlyOpenedActive, selectedColors]`.

Replace the three color handlers:

```javascript
    const handleToggleColor = (colorName) => {
        if (!isMountedRef.current) return;
        setSelectedColors((prev) =>
            prev.includes(colorName) ? prev.filter((c) => c !== colorName) : [...prev, colorName]
        );
    };

    const handleColorClear = () => {
        if (isMountedRef.current) setSelectedColors([]);
    };

    const handleClearAll = () => {
        if (isMountedRef.current) {
            setRecentlyOpenedActive(false);
            setSelectedColors([]);
        }
    };
```

`hasActiveFilters`:

```javascript
    const hasActiveFilters = recentlyOpenedActive || selectedColors.length > 0;
```

`ColorFilter` usage in JSX:

```javascript
                <ColorFilter
                    selectedColors={selectedColors}
                    onToggleColor={handleToggleColor}
                    onClear={handleColorClear}
                />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test tests/CollectionFilter.test.js`
Expected: PASS — all blocks, including the original tooltip test (the trigger/grid still render identically).

- [ ] **Step 5: Commit**

```bash
git add app/CollectionFilter.js tests/CollectionFilter.test.js
git commit -m "feat: multi-color selection in popup collection filter"
```

---

### Task 4: Full-page view — FPContentArea.js multi-color

**Files:**
- Modify: `app/fullpage/FPContentArea.js` (`colorFilter` state ~line 949; `emitFiltersChange` ~2455; `handleColorFilterChange` ~2475; `clearAllFilters` ~2484; `hasLocalActiveFilters` ~2490; ColorPicker render ~3059)
- Test: `tests/FPContentArea.test.js` (extend if a color-filter test exists; otherwise rely on Task 1 logic + manual verification)

- [ ] **Step 1: Convert state to colors array**

In `app/fullpage/FPContentArea.js`, change (~line 949):

```javascript
    const [colorsFilter, setColorsFilter] = useState([]);
```

(replace `const [colorFilter, setColorFilter] = useState(null);`)

Search the file for all remaining references to `colorFilter` / `setColorFilter` and update each per the steps below. Pay attention to the effect that mirrors filters from the parent (~lines 986-989) — initialize from `filters.colors ?? []`.

- [ ] **Step 2: Update emit + handlers**

`emitFiltersChange` (~2460): change `color: nextFilters.color` to `colors: nextFilters.colors`.

`toggleRecentlyOpenedFilter` (~2469): change `color: colorFilter` to `colors: colorsFilter`.

`handleColorFilterChange`:

```javascript
    const handleColorFilterChange = (color) => {
        const newColors = colorsFilter.includes(color)
            ? colorsFilter.filter((c) => c !== color)
            : [...colorsFilter, color];
        setColorsFilter(newColors);
        emitFiltersChange({
            recentlyOpenedActual: recentlyOpenedFilter,
            colors: newColors,
        });
    };

    const handleColorFilterClear = () => {
        setColorsFilter([]);
        emitFiltersChange({
            recentlyOpenedActual: recentlyOpenedFilter,
            colors: [],
        });
    };
```

`clearAllFilters`:

```javascript
    const clearAllFilters = () => {
        setRecentlyOpenedFilter(false);
        setColorsFilter([]);
        emitFiltersChange({ recentlyOpenedActual: false, colors: [] });
    };
```

`hasLocalActiveFilters`:

```javascript
    const hasLocalActiveFilters = recentlyOpenedFilter || colorsFilter.length > 0;
```

- [ ] **Step 3: Wire ColorPicker (~line 3059)**

```javascript
                    <ColorPicker
                        multiSelect
                        selectedColors={colorsFilter}
                        action={handleColorFilterChange}
                        onClear={handleColorFilterClear}
                        tooltip="Filter by color"
                        size="small"
                    />
```

- [ ] **Step 4: Run the full suite**

Run: `yarn test`
Expected: PASS. If `tests/FPContentArea.test.js` references `colorFilter`/`color:` filter payloads, update them to the `colorsFilter`/`colors` array shape.

- [ ] **Step 5: Commit**

```bash
git add app/fullpage/FPContentArea.js tests/FPContentArea.test.js
git commit -m "feat: multi-color selection in full-page collection filter"
```

---

### Task 5: Verification & production build

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `yarn lint`
Expected: no new errors in the touched files.

- [ ] **Step 2: Full test suite**

Run: `yarn test`
Expected: all PASS.

- [ ] **Step 3: Production build (required by CLAUDE.md)**

Run: `yarn prod`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit any incidental fixes**

```bash
git add -A
git commit -m "chore: verify multi-color filter build"
```

(Skip if nothing changed.)
