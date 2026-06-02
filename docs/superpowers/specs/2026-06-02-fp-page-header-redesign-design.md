# Full-page View — Page Header Redesign

**Date:** 2026-06-02
**Area:** `app/fullpage/` — content area page header

## Problem

The full-page view's per-page header is currently a **floating, centered glassmorphic pill**: `width: min(100%, 780px)`, rounded `18px`, sticky-positioned and visually detached, floating over the scrolling content (`.fp-content-title-row` / `.fp-floating-header-shell` / `.fp-content-heading` in `FPContentArea.css`). It uses a left accent stripe (`::before`), backdrop blur, and stacked badge/title/count/subtitle.

This floating pill feels disconnected from the top bar and wastes horizontal space.

## Goal

Replace it with a **full-width, single-row header attached directly below the main top bar** (`FPTopBar`), with a per-page accent color expressed as a gradient wash.

## Approved Design

A compact single-row bar, full content-width, sitting flush under the top bar. Layout, left to right, on one line:

1. **Badge** — accent-colored pill (e.g. "Library area", "Live view", "History", "Folder"), uppercase, tinted background in the accent color.
2. **Title** — e.g. "All Collections" (`~17px`, weight 700, `-0.03em`).
3. **Count pill** — e.g. "27 collections", accent-tinted rounded pill.
4. **Separator** — a muted `·`.
5. **Subtitle** — e.g. "Everything you have saved in Tabox", muted, ellipsis-truncated.

### Accent treatment

- The **only** background accent is a **left→right gradient wash** that fades into transparency:
  `linear-gradient(90deg, color-mix(accent 24%, transparent) 0%, color-mix(accent 6%, transparent) 42%, transparent 100%)`.
- **No** left accent stripe, **no** accent dot, **no** bottom underline rule.
- The badge retains the accent color (text + tinted background).
- Accent color is driven per page by the existing `contentHeading.accentColor` value (already computed), passed via a CSS custom property (e.g. `--accent` / reuse existing `--fp-heading-accent`).

### Per-page accent colors (unchanged from current logic)

- All Collections / No Folder / generic / search → `var(--primary-color)` (blue)
- Current Windows → `#65A30D` (green, `CURRENT_WINDOWS_ACCENT_COLOR`)
- Recently Closed → `#F59E0B` (amber)
- Folder pages → the folder's color

## Scope

- **Markup:** Simplify the header JSX in `FPContentArea.js` (around line 3712–3738) from the stacked meta/main/supporting structure to a single inline row: badge, title, count, separator, subtitle. The `contentHeading` data object (badge/title/subtitle/countLabel/accentColor/showColorIndicator) stays as-is, though `showColorIndicator` and the color-indicator dot are no longer rendered.
- **CSS:** Rework the header block in `FPContentArea.css` (lines ~23–197) plus the responsive overrides (~1957–2010):
  - `.fp-content-title-row` / `.fp-floating-header-row`: change from centered, sticky-floating, `height: 0`, `pointer-events: none` to a normal full-width flex row flush under the top bar.
  - Remove the floating pill shell styling (`.fp-floating-header-shell` glass background, blur, shadow, rounding) and the `.fp-content-heading::before` stripe.
  - Apply the gradient wash to the row, single-line flex layout, ellipsis on subtitle.
  - Reconcile the floating-toolbar offset variables (`--fp-floating-title-top`, `--fp-floating-title-height`, `--fp-floating-toolbar-top`, `--fp-floating-stack-offset` in `.fp-content`) so the sticky toolbar below still positions correctly now that the header is a normal-flow full-width bar rather than a floating element.

## Out of Scope

- The top bar (`FPTopBar`) itself.
- The centered floating toolbar's own design (only its vertical offset relative to the new header may need adjustment).
- The popup view (this is full-page only).
- Accent color values / `contentHeading` logic — reused unchanged.

## Verification

- `yarn prod` build passes.
- Visually confirm in the loaded extension across: All Collections, No Folder, a folder, Current Windows, Recently Closed, and an active search — header is full-width under the top bar, single row, gradient recolors per page, toolbar below still sticks correctly.
- Check light and dark themes.
