# Popup Toolbar FP Style Match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `CollectionListOptions.css` so the popup toolbar visually matches the fullscreen (`FPContentArea`) toolbar in both light and dark themes.

**Architecture:** Pure CSS change to one file. The `.collections-toolbar` container gets a neutral frosted-glass background instead of the current bluish-gray gradient. Individual buttons and the sort select lose their explicit borders (borderless icon buttons, matching FP). The divider adopts FP dimensions and colors. All hover backgrounds switch to the FP token values. No JS changes.

**Tech Stack:** CSS, Webpack 5 (`yarn dev` / `yarn prod`)

---

## Files

- Modify: `app/CollectionListOptions.css`

---

### Task 1: Update container background, shadow, border, and sizing

These are the `.collections-toolbar` and its `[data-theme="dark"]` override.

**Files:**
- Modify: `app/CollectionListOptions.css`

- [ ] **Step 1: Replace `.collections-toolbar` light styles**

In `app/CollectionListOptions.css`, replace the `.collections-toolbar` block (lines 14–37) with:

```css
.collections-toolbar {
    display: inline-flex;
    align-items: center;
    gap: 0;
    width: min(calc(100% - 16px), 760px);
    padding: 5px 7px;
    border-radius: 14px;
    background: rgba(248, 250, 252, 0.58);
    backdrop-filter: saturate(1.25) blur(18px);
    -webkit-backdrop-filter: saturate(1.25) blur(18px);
    border: 1px solid rgba(15, 23, 42, 0.10);
    box-shadow:
        0 14px 34px rgba(15, 23, 42, 0.16),
        0 2px 8px rgba(15, 23, 42, 0.06),
        inset 0 1px 0 rgba(255, 255, 255, 0.45);
    pointer-events: auto;
}
```

- [ ] **Step 2: Replace dark override**

Replace the `[data-theme="dark"] .collections-toolbar` block (lines 39–55) with:

```css
[data-theme="dark"] .collections-toolbar {
    background: rgba(43, 43, 43, 0.58);
    backdrop-filter: saturate(1.25) blur(18px);
    -webkit-backdrop-filter: saturate(1.25) blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        0 14px 30px rgba(0, 0, 0, 0.26),
        0 2px 8px rgba(0, 0, 0, 0.16),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 3: Run build**

```bash
yarn prod
```

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/CollectionListOptions.css
git commit -m "style: update toolbar container to FP neutral frosted-glass"
```

---

### Task 2: Remove borders from buttons

`.fp-toolbar-btn` currently has `border: 1px solid var(--fp-border, var(--divider-color))`. Remove it so buttons show only an icon with no visual frame. Hover shows a tinted background.

**Files:**
- Modify: `app/CollectionListOptions.css`

- [ ] **Step 1: Update `.fp-toolbar-btn`**

Find the `.fp-toolbar-btn` block and replace it with:

```css
.fp-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 9px;
    border: none;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    flex-shrink: 0;
    transition:
        background var(--fp-duration, 0.2s) var(--fp-ease, ease),
        color var(--fp-duration, 0.2s) var(--fp-ease, ease),
        box-shadow var(--fp-duration, 0.2s) var(--fp-ease, ease),
        transform 0.1s var(--fp-ease, ease);
}
```

- [ ] **Step 2: Update `.fp-toolbar-btn:hover`**

Replace the `.fp-toolbar-btn:hover` block:

```css
.fp-toolbar-btn:hover {
    background: rgba(15, 23, 42, 0.06);
}
```

- [ ] **Step 3: Add dark hover override**

After the existing `[data-theme="dark"] .fp-toolbar-btn.active` rule, add:

```css
[data-theme="dark"] .fp-toolbar-btn:hover {
    background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 4: Update `.fp-toolbar-btn:disabled:hover`**

The disabled hover was resetting border-color. Remove that property since there's no border:

```css
.fp-toolbar-btn:disabled:hover {
    background: transparent;
    color: var(--text-color);
}
```

- [ ] **Step 5: Run build**

```bash
yarn prod
```

Expected: build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/CollectionListOptions.css
git commit -m "style: remove borders from toolbar buttons (borderless icon style)"
```

---

### Task 3: Update sort select control to borderless + tinted background

The `react-select` control (`.toolbar-select__control`) currently has a visible border. Match FP: no border, subtle background tint that darkens on hover.

**Files:**
- Modify: `app/CollectionListOptions.css`

- [ ] **Step 1: Replace `.toolbar-select__control`**

```css
.toolbar-select__control {
    min-height: 38px !important;
    height: 38px !important;
    border-radius: 9px !important;
    border: 0 !important;
    background: rgba(15, 23, 42, 0.05) !important;
    box-shadow: none !important;
    cursor: pointer !important;
    transition:
        background var(--fp-duration, 0.2s) var(--fp-ease, ease),
        color var(--fp-duration, 0.2s) var(--fp-ease, ease) !important;
}
```

- [ ] **Step 2: Replace `.toolbar-select__control:hover` and `--menu-is-open`**

```css
.toolbar-select__control:hover,
.toolbar-select__control--menu-is-open {
    background: rgba(15, 23, 42, 0.06) !important;
}
```

- [ ] **Step 3: Replace `.toolbar-select__control--is-focused`**

```css
.toolbar-select__control--is-focused {
    background: rgba(15, 23, 42, 0.06) !important;
    box-shadow: none !important;
}
```

- [ ] **Step 4: Add dark theme overrides for select control**

After the existing `[data-theme="dark"] .toolbar-select__control--is-focused` rule (or add after the focused rule), add:

```css
[data-theme="dark"] .toolbar-select__control {
    background: rgba(255, 255, 255, 0.10) !important;
}

[data-theme="dark"] .toolbar-select__control:hover,
[data-theme="dark"] .toolbar-select__control--menu-is-open,
[data-theme="dark"] .toolbar-select__control--is-focused {
    background: rgba(255, 255, 255, 0.08) !important;
}
```

- [ ] **Step 5: Run build**

```bash
yarn prod
```

Expected: build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/CollectionListOptions.css
git commit -m "style: update sort select to borderless with tinted background"
```

---

### Task 4: Update divider height and colors

The `.fp-toolbar-divider` needs to match FP: 38px tall (bleeds through the 5px vertical padding), hardcoded rgba colors instead of CSS variables, no opacity reduction.

**Files:**
- Modify: `app/CollectionListOptions.css`

- [ ] **Step 1: Replace `.fp-toolbar-divider`**

```css
.fp-toolbar-divider {
    width: 1px;
    height: 38px;
    background: rgba(15, 23, 42, 0.12);
    flex-shrink: 0;
    margin: 0 7px;
}
```

- [ ] **Step 2: Add dark override for divider**

Add immediately after:

```css
[data-theme="dark"] .fp-toolbar-divider {
    background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 3: Run build**

```bash
yarn prod
```

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/CollectionListOptions.css
git commit -m "style: update toolbar divider to FP full-height style"
```

---

### Task 5: Remove borders from pill, segment, color-picker; update hover backgrounds

`.fp-toolbar-pill`, `.fp-toolbar-segment`, and `.fp-toolbar-color-picker` all carry `border: 1px solid` in the popup CSS but FP has `border: 0` on all of them. Also update hover backgrounds away from `var(--setting-row-hover-bg-color)`.

**Files:**
- Modify: `app/CollectionListOptions.css`

- [ ] **Step 1: Update `.fp-toolbar-pill`**

Replace the full `.fp-toolbar-pill` block:

```css
.fp-toolbar-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 38px;
    padding: 0 16px;
    border-radius: 9px;
    border: 0;
    background: transparent;
    color: var(--text-color);
    font-family: var(--fp-font-body, -apple-system, 'Segoe UI', system-ui, BlinkMacSystemFont, 'Helvetica Neue', sans-serif);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
        background var(--fp-duration, 0.2s) var(--fp-ease, ease),
        color var(--fp-duration, 0.2s) var(--fp-ease, ease),
        box-shadow var(--fp-duration, 0.2s) var(--fp-ease, ease);
}
```

- [ ] **Step 2: Update `.fp-toolbar-pill:hover`**

```css
.fp-toolbar-pill:hover {
    background: rgba(15, 23, 42, 0.06);
}
```

- [ ] **Step 3: Update `.fp-toolbar-color-picker`**

Replace the full `.fp-toolbar-color-picker` block:

```css
.fp-toolbar-color-picker {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 38px;
    padding: 0 10px;
    border-radius: 9px;
    border: 0;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--fp-duration, 0.2s) var(--fp-ease, ease);
}
```

- [ ] **Step 4: Update `.fp-toolbar-color-picker:hover`**

```css
.fp-toolbar-color-picker:hover {
    background: rgba(15, 23, 42, 0.06);
}
```

- [ ] **Step 5: Update `.fp-toolbar-segment`**

Replace the full `.fp-toolbar-segment` block:

```css
.fp-toolbar-segment {
    display: flex;
    border-radius: 9px;
    border: 0;
    overflow: hidden;
    background: transparent;
}
```

- [ ] **Step 6: Update `.fp-toolbar-segment-btn:hover`**

```css
.fp-toolbar-segment-btn:hover {
    background: rgba(15, 23, 42, 0.06);
}
```

- [ ] **Step 7: Add dark hover overrides**

After the existing `[data-theme="dark"] .fp-toolbar-segment-btn.active` rule, add:

```css
[data-theme="dark"] .fp-toolbar-pill:hover {
    background: rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .fp-toolbar-color-picker:hover {
    background: rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .fp-toolbar-segment-btn:hover {
    background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 4: Run final build and verify**

```bash
yarn prod
```

Expected: build completes with no errors.

Run `yarn test` to confirm no regressions in CollectionListOptions tests:

```bash
yarn test --testPathPattern=CollectionListOptions
```

Expected: all tests pass.

- [ ] **Step 5: Final commit**

```bash
git add app/CollectionListOptions.css
git commit -m "style: update pill and segment hover to FP token values"
```
