# Popup Toolbar — FP Style Match

**Date:** 2026-05-20  
**Scope:** `app/CollectionListOptions.css` only — no JS changes  

## Problem

The `CollectionListOptions` toolbar (sort, direction, open-in-new, folder, view mode, session restore, import) uses a distinct visual style in the popup that diverges from the fullscreen (`FPContentArea`) toolbar. Specifically:

- The popup toolbar uses a **bluish-gray gradient** container background
- Individual buttons carry **visible borders** (`border: 1px solid`)
- The sort select is **bordered** with transparent background
- The divider is short (26px) and uses `--fp-border`
- The dark theme uses a **cool bluish-dark gradient** rather than the neutral dark the FP uses

## Goal

Make the popup toolbar visually match the fullscreen toolbar defined in `FPContentArea.css` — same container treatment, same borderless button approach, same dark theme values — for both light and dark themes.

## Design

### Container (`.collections-toolbar`)

| Property | Current | Target |
|----------|---------|--------|
| `background` | `linear-gradient(145deg, rgba(214,219,226,0.42)…)` | `rgba(248, 250, 252, 0.58)` |
| `border-radius` | `var(--fp-radius-lg, 16px)` | `14px` |
| `padding` | `6px 10px` | `5px 7px` |
| `gap` | `4px` | `0` |
| `box-shadow` | soft outer only | outer + `inset 0 1px 0 rgba(255,255,255,0.45)` |
| `border` | `rgba(255,255,255,0.24)` | `rgba(15,23,42,0.10)` |

Dark override (`.collections-toolbar` under `[data-theme="dark"]`):

| Property | Current | Target |
|----------|---------|--------|
| `background` | `linear-gradient(145deg, rgba(26,31,42,0.4)…)` | `rgba(43, 43, 43, 0.58)` |
| `border` | `rgba(255,255,255,0.08)` | same — no change |
| `box-shadow` | outer only | outer + `inset 0 1px 0 rgba(255,255,255,0.08)` |

These values mirror the `--fp-toolbar-bg/border/control-shadow` vars defined on `.fp-toolbar` in `FPContentArea.css`.

### Buttons (`.fp-toolbar-btn`)

Remove the explicit `border: 1px solid var(--fp-border)`. The FP toolbar uses `border: 0` — buttons are borderless and show hover state only via background tint. The `[data-theme="dark"]` active state shadow is unchanged.

### Sort Select (`.toolbar-select__control`)

- Remove `border: 1px solid …` → `border: 0`
- Add `background: rgba(15, 23, 42, 0.05)` (light) / `rgba(255, 255, 255, 0.10)` (dark)
- Change `border-radius` from `var(--fp-radius-md, 12px)` → `9px`

### Divider (`.fp-toolbar-divider`)

- Height: `26px` → `38px` (bleeds to container padding edges, matching FP)
- Margin: `0 6px` — keep as-is
- Background: change from `var(--fp-border, var(--divider-color))` → `rgba(15, 23, 42, 0.12)` (light) / `rgba(255, 255, 255, 0.12)` (dark)
- Remove `opacity: 0.7` (FP divider has full opacity via its variable)

### Hover backgrounds

`.fp-toolbar-btn:hover` and pill/segment hover currently use `var(--setting-row-hover-bg-color)`. Update to use the FP token values inline:
- Light: `rgba(15, 23, 42, 0.06)`
- Dark: `rgba(255, 255, 255, 0.08)` (already handled by `[data-theme="dark"]` overrides where needed)

## Files Changed

- `app/CollectionListOptions.css` — all changes are in this file only

## What Does NOT Change

- Component structure (JS) — no changes
- Active state styling on buttons/pills
- The `[data-theme="dark"]` button active state
- Select menu dropdown styling
- `toolbar-select-shell` min-width
- Responsive styles at 720px
