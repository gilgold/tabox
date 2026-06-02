# Multi-Color Collection Filter — Design

**Date:** 2026-06-01
**Status:** Approved
**Scope:** Both the popup view (`CollectionFilter.js`) and the full-page view (`FPContentArea.js`).

## Goal

Let users filter collections by **multiple colors at once** instead of a single color.
Add a **"Clear"** action inside the color-filter popover to deselect all colors in one click.
Show the active selection in the trigger swatch: a solid square for one color, a multi-color
gradient for two or more.

## Current Behavior (baseline)

- Filter state carries a single `color` (string color-name or `null`).
- `App.js` `DEFAULT_COLLECTION_FILTERS = { recentlyOpenedActual: false, color: null }`.
- `collectionsToShow` (`App.js`) filters by `normalizeColorKey(collection.color) === normalizeColorKey(filters.color)`.
- `ColorPicker` is shared between collection color-editing (single-select, closes on pick) and
  the filter. Clicking the already-selected color toggles it off.
- Popup (`CollectionFilter.js`) holds `selectedColor` state; full-page (`FPContentArea.js`)
  holds `colorFilter` state. Both emit `{ recentlyOpenedActual, color }` up to `App.js`.

## Filter Logic — OR semantics

Selected colors are combined with **OR**: a collection is shown when its color matches **any**
of the selected colors. An empty selection means "no color filter" (show all).

## Data Model & State Changes

Replace the single `color` value with a `colors` **array of color-name strings** (empty = no filter).

### `app/App.js`
- `DEFAULT_COLLECTION_FILTERS` → `{ recentlyOpenedActual: false, colors: [] }`.
- `collectionsToShow` color block:
  ```js
  if (filters.colors?.length) {
    const selected = new Set(filters.colors.map(normalizeColorKey));
    filteredCollections = filteredCollections.filter(
      (collection) => selected.has(normalizeColorKey(collection.color))
    );
  }
  ```
- `handleFiltersChange` already spreads over `DEFAULT_COLLECTION_FILTERS`, so it carries `colors`
  through unchanged once the default is updated.

## `ColorPicker` — opt-in multi-select mode

`ColorPicker` stays backward-compatible. Single-select (collection color-editing) is unchanged.
Add an opt-in multi-select mode via new props:

- `multiSelect` (bool, default `false`)
- `selectedColors` (array of color names, used when `multiSelect`)
- `onClear` (callback, used when `multiSelect`)

Behavior when `multiSelect` is on:
- Clicking a swatch calls `action(colorName)`; the **parent** toggles add/remove. The popover
  **stays open** (no `setShowPicker(false)` on pick).
- **Every** color in `selectedColors` renders the checkmark `selection-indicator` (not just one
  `selectedColorCircle`).
- A **"Clear" row** renders at the bottom of the palette grid, calling `onClear`. It is
  disabled/greyed when `selectedColors` is empty.

### Trigger swatch preview
The `current-color-preview` circle reflects the selection:
- **0 colors** → neutral/default (current empty state).
- **1 color** → solid fill of that color (current behavior).
- **2+ colors** → `linear-gradient(135deg, …)` built from the selected colors' hex values
  (resolved via `getColorValue` / `COLOR_PALETTE`) with even stops across all selected colors.

The trigger keeps an **active** highlight while any color is selected.

## View Wiring

### Popup — `app/CollectionFilter.js`
- `ColorFilter`: `selectedColor` prop → `selectedColors` array; pass `multiSelect`,
  `selectedColors`, `onClear` into `ColorPicker`. `handleColorSelect` toggles add/remove.
- `CollectionFilter`: `selectedColor` state → `selectedColors` array.
  - `handleColorChange(colorName)` toggles the color in the array.
  - `handleColorClear()` sets `[]`.
  - `handleClearAll()` resets recently-opened + `colors` to `[]`.
  - Effect emits `{ recentlyOpenedActual, colors }`.
  - `hasActiveFilters = recentlyOpenedActive || selectedColors.length > 0`.

### Full page — `app/fullpage/FPContentArea.js`
- `colorFilter` state → `colorsFilter` array (init `[]`).
- `handleColorFilterChange(color)` toggles the color in the array, then `emitFiltersChange`.
- `emitFiltersChange` passes `colors` instead of `color`.
- `clearAllFilters` resets `colorsFilter` to `[]`.
- `hasLocalActiveFilters = recentlyOpenedFilter || colorsFilter.length > 0`.
- Wire `multiSelect`, `selectedColors={colorsFilter}`, `onClear` into the toolbar `ColorPicker`.

## CSS

- `ColorPicker.css` (or co-located styles): style the new "Clear" row inside
  `.modern-color-popover` (text button, disabled state).
- Gradient preview is set inline via `style={{ background: gradient }}` on the trigger circle.

## Testing

Extend existing Jest tests (`tests/CollectionFilter.test.js`, plus `App` filter coverage):
- Multi-color OR match: collections of any selected color are shown; others hidden.
- Empty `colors` → all collections shown (no color filtering).
- Toggle: selecting an already-selected color removes it; selecting a new color adds it.
- Clear: `onClear` empties the selection.
- Trigger preview: 1 color → solid; 2+ → gradient string containing each selected color's hex.

## Out of Scope (YAGNI)

- Persisting the color selection across sessions (filters are session-local today).
- Reordering or grouping colors in the palette.
- AND semantics (a collection has a single color, so AND is meaningless for multi-select).
