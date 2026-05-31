# PipelinePro

Confident, structured, pipeline-obsessed.

## Overview

PipelinePro is a design system engineered for CRM and sales pipeline management tools where deals flow through stages and every interaction counts. The design language is bold and structured: strong indigo anchors convey authority, while cyan and orange accents highlight motion and urgency across kanban boards, tables, and deal cards. Standard density with a compact 4px base keeps layouts tight enough for data-rich views yet readable enough for extended use. Built for sales teams who think in funnels, stages, and close rates.

PipelinePro supports both light and dark themes through semantic tokens. Component specifications should reference tokens first, then fall back to the raw color values only when defining the token itself.

## Theme Tokens

### Core Colors

| Token | Light Theme | Dark Theme | Usage |
| --- | --- | --- | --- |
| `--color-primary` | `#4F46E5` | `#1490f1` | Primary actions, active pipeline stages, key CTAs |
| `--color-primary-hover` | `#4338CA` | `#A5B4FC` | Primary action hover states |
| `--color-primary-active` | `#3730A3` | `#C7D2FE` | Primary action active states |
| `--color-secondary` | `#06B6D4` | `#22D3EE` | Hyperlinks, secondary highlights, deal value accents |
| `--color-tertiary` | `#F97316` | `#FB923C` | Urgency markers, due-soon indicators, hot leads |
| `--color-success` | `#22C55E` | `#4ADE80` | Positive status, won deals |
| `--color-warning` | `#F59E0B` | `#FBBF24` | Warnings and review states |
| `--color-error` | `#EF4444` | `#F87171` | Destructive actions, validation errors, lost deals |
| `--color-info` | `#4F46E5` | `#1490f1` | Informational states |

### Surfaces And Text

| Token | Light Theme | Dark Theme | Usage |
| --- | --- | --- | --- |
| `--color-background` | `#FAFAFA` | `#09090B` | App-level canvas |
| `--color-surface` | `#FFFFFF` | `#18181B` | Cards, modals, deal panels |
| `--color-surface-raised` | `#FFFFFF` | `#27272A` | Elevated panels, popovers, floating controls |
| `--color-surface-muted` | `#F4F4F5` | `#27272A` | Subtle hover states and grouped controls |
| `--color-text` | `#18181B` | `#FAFAFA` | Primary text |
| `--color-text-muted` | `#71717A` | `#A1A1AA` | Secondary text, helper text, quiet metadata |
| `--color-text-subtle` | `#A1A1AA` | `#71717A` | Placeholders, disabled text, low-emphasis labels |
| `--color-text-inverse` | `#FFFFFF` | `#18181B` | Text on filled accent backgrounds |
| `--color-border` | `#E4E4E7` | `#3F3F46` | Default borders and dividers |
| `--color-border-strong` | `#D4D4D8` | `#52525B` | Hover borders and stronger separation |
| `--color-focus-ring` | `rgb(79 70 229 / 12%)` | `rgb(129 140 248 / 24%)` | Focus rings |

### State Tokens

| Token | Light Theme | Dark Theme | Usage |
| --- | --- | --- | --- |
| `--color-selected-bg` | `#EEF2FF` | `#0c2953` | Selected list items, selected secondary controls |
| `--color-hover-bg` | `#F4F4F5` | `#27272A` | Neutral hover states |
| `--color-tooltip-bg` | `#18181B` | `#FAFAFA` | Tooltip surface |
| `--color-tooltip-text` | `#FAFAFA` | `#18181B` | Tooltip text |
| `--color-success-bg` | `#F0FDF4` | `#052E16` | Won status chip background |
| `--color-success-text` | `#16A34A` | `#86EFAC` | Won status chip text |
| `--color-success-border` | `#BBF7D0` | `#166534` | Won status chip border |
| `--color-risk-bg` | `#FFF7ED` | `#431407` | At-risk status chip background |
| `--color-risk-text` | `#EA580C` | `#FDBA74` | At-risk status chip text |
| `--color-risk-border` | `#FED7AA` | `#9A3412` | At-risk status chip border |
| `--color-lost-bg` | `#FEF2F2` | `#450A0A` | Lost status chip background |
| `--color-lost-text` | `#DC2626` | `#FCA5A5` | Lost status chip text |
| `--color-lost-border` | `#FECACA` | `#991B1B` | Lost status chip border |

## Theme Implementation

Use the light theme as the default. Apply the dark theme when a root element exposes `data-theme="dark"` or when the application maps a user preference to equivalent CSS custom properties.

```css
:root,
[data-theme="light"] {
  --color-primary: #4F46E5;
  --color-primary-hover: #4338CA;
  --color-primary-active: #3730A3;
  --color-secondary: #06B6D4;
  --color-tertiary: #F97316;
  --color-background: #FAFAFA;
  --color-surface: #FFFFFF;
  --color-surface-raised: #FFFFFF;
  --color-surface-muted: #F4F4F5;
  --color-text: #18181B;
  --color-text-muted: #71717A;
  --color-text-subtle: #A1A1AA;
  --color-text-inverse: #FFFFFF;
  --color-border: #E4E4E7;
  --color-border-strong: #D4D4D8;
  --color-focus-ring: rgb(79 70 229 / 12%);
  --fp-card-radius: 12px;
  --fp-radius-xs: 6px;
  --fp-radius-sm: 12px;
  --fp-radius-md: 12px;
  --fp-radius-lg: 16px;
  --fp-radius-xl: 24px;
}

[data-theme="dark"] {
  color-scheme: dark;
  --color-primary: #1490f1;
  --color-primary-hover: #A5B4FC;
  --color-primary-active: #C7D2FE;
  --color-secondary: #22D3EE;
  --color-tertiary: #FB923C;
  --color-background: #09090B;
  --color-surface: #18181B;
  --color-surface-raised: #27272A;
  --color-surface-muted: #27272A;
  --color-text: #FAFAFA;
  --color-text-muted: #A1A1AA;
  --color-text-subtle: #71717A;
  --color-text-inverse: #18181B;
  --color-border: #3F3F46;
  --color-border-strong: #52525B;
  --color-focus-ring: rgb(129 140 248 / 24%);
}
```

## Typography

- **Headline Font:** Outfit
- **Body Font:** Inter
- **Mono Font:** Source Code Pro

| Style | Specification | Usage |
| --- | --- | --- |
| Display | Outfit 52px bold, 1.1 line height, 0.02em tracking | Revenue hero numbers |
| Headline | Outfit 38px bold, 1.2 line height, 0.015em tracking | Page headings, pipeline titles |
| Subhead | Outfit 26px semibold, 1.3 line height, 0.01em tracking | Stage headers, section titles |
| Body Large | Inter 18px regular, 1.6 line height | Lead paragraphs, deal summaries |
| Body | Inter 15px regular, 1.6 line height | Default body text |
| Body Small | Inter 14px regular, 1.5 line height | Table cells, card metadata |
| Caption | Inter 12px medium, 1.4 line height, 0.01em tracking | Timestamps, stage counts, labels |
| Overline | Inter 11px bold, 1.2 line height, 0.09em tracking | Pipeline stage names, deal tags, uppercase |
| Code | Source Code Pro 14px regular, 1.5 line height | API keys, integration IDs, formulas |

## Spacing

- **Base unit:** 4px
- **Scale:** 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80
- **Component padding:** 8px small, 12px medium, 16px large
- **Section spacing:** 24px mobile, 40px tablet, 56px desktop

## Border Radius

- **None:** 0px for table cells and inline data badges
- **Small:** 6px for small tags, keyboard hints, favicon tiles, compact status indicators, and full-page badges
- **Medium:** 12px for cards, buttons, inputs, chips, menus, and standard modal controls
- **Large:** 16px for feature panels, grouped surfaces, and larger dialogs
- **XL:** 24px for modal shells, popovers, empty-state panels, and prominent overlay surfaces
- **Full:** 9999px for avatars and stage dots

## Elevation

PipelinePro uses Material-style layered shadows to create a clear visual hierarchy between pipeline columns, deal cards, and overlay surfaces. In dark theme, reduce black shadow opacity and pair elevation with subtle borders or raised surfaces so depth remains visible without muddying the interface.

- **Subtle:** 0 1px 2px `rgb(24 24 27 / 5%)`; dark theme: 0 1px 2px `rgb(0 0 0 / 24%)`
- **Medium:** 0 4px 6px -1px `rgb(24 24 27 / 7%)`, 0 2px 4px -2px `rgb(24 24 27 / 5%)`; dark theme: 0 8px 16px -8px `rgb(0 0 0 / 45%)`
- **Large:** 0 10px 15px -3px `rgb(24 24 27 / 8%)`, 0 4px 6px -4px `rgb(24 24 27 / 4%)`; dark theme: 0 18px 32px -18px `rgb(0 0 0 / 60%)`
- **Overlay:** 0 20px 25px -5px `rgb(24 24 27 / 12%)`, 0 8px 10px -6px `rgb(24 24 27 / 6%)`; dark theme: 0 24px 48px -24px `rgb(0 0 0 / 70%)`
- **Drag:** 0 12px 24px -4px `rgb(79 70 229 / 15%)`; dark theme: 0 12px 28px -6px `rgb(129 140 248 / 28%)`

## Components

### Buttons

- **Primary Filled:** `--color-primary` fill, `--color-text-inverse` text, 12px corners. Inter 14px 600. 8px vertical and 18px horizontal padding. Hover uses `--color-primary-hover`. Active uses `--color-primary-active` and `scale(0.98)`.
- **Secondary Outline:** Transparent fill, `--color-primary` text, 1px `--color-primary` border, 12px corners. 8px vertical and 18px horizontal padding. Hover uses `--color-selected-bg`.
- **Ghost:** Transparent fill, `--color-text-muted` text. Hover uses `--color-hover-bg` and `--color-text`.
- **Destructive:** `--color-error` fill, white text in light theme, `#18181B` text in dark theme when using the lighter dark error token. Hover shifts to `#DC2626` in light theme and `#FCA5A5` in dark theme.
- **Sizes:** Small 32px, medium 38px, large 46px.
- **Disabled:** 40% opacity, disabled cursor.

### Cards

- **Default:** `--color-surface` fill, 1px `--color-border` border, 12px corners, 16px padding. Hover shifts border to `--color-border-strong`.
- **Elevated:** Medium shadow over `--color-surface-raised`. Hover transitions to large shadow and `translateY(-2px)`.

### Inputs

- **Text Input:** `--color-surface` fill, 1px `--color-border` border, `--color-text` text, 12px corners. Inter 14px. `--color-text-subtle` placeholder, 8px vertical and 12px horizontal padding, 38px tall. Focus uses `--color-primary` border and a 3px `--color-focus-ring`. Error uses `--color-error` border and message text. Disabled uses `--color-background`, 50% text opacity.
- **Label:** Above input, Inter 13px 500, `--color-text`.
- **Helper Text:** Inter 12px, `--color-text-muted`.

### Chips

- **Filter Chip:** 12px corners, 1px `--color-border` border, Inter 13px 500, 30px tall, 10px horizontal padding. Selected uses `--color-primary` background, `--color-text-inverse` text, and transparent border. Hover uses `--color-hover-bg`.
- **Status Chip, Won:** `--color-success-bg` background, `--color-success-text` text, `--color-success-border` border.
- **Status Chip, At Risk:** `--color-risk-bg` background, `--color-risk-text` text, `--color-risk-border` border.
- **Status Chip, Lost:** `--color-lost-bg` background, `--color-lost-text` text, `--color-lost-border` border.

### Badges

Full-page badges use the shared `FPBadge` component. They have 6px corners, a 1px accent-tinted border, Inter 12px 650, 22px minimum height, 3px vertical and 9px horizontal padding, and no negative tracking. Use semantic accents for common states: tabs use success green, groups and recently closed states use tertiary orange, matches use neutral slate, current-window live states use the current-window accent, and folders may pass the folder color as a raw accent value. Badge variants should adjust only size or accent tokens, not the underlying shape.

### Lists

- **Default List Item:** Inter 14px, 44px tall, 10px vertical and 12px horizontal padding, 1px `--color-hover-bg` divider, 18px icon, 10px spacing from text with icon. Hover uses `--color-background` in light theme and `--color-surface-muted` in dark theme. Selected uses `--color-selected-bg`, `--color-primary` text, and a 2px `--color-primary` left border.

### Checkboxes

16px box, 1.5px `--color-border-strong` border, 6px corners. Checked uses `--color-primary` background with a white checkmark in light theme and `#18181B` checkmark in dark theme. Indeterminate uses `--color-primary` background with matching dash color. Disabled uses 40% opacity. Labels use Inter 14px with 8px spacing from the box.

### Radio Buttons

16px outer circle, 1.5px `--color-border-strong` border. Selected uses `--color-primary` border and an 8px `--color-primary` inner dot. Disabled uses 40% opacity. Labels use Inter 14px with 8px spacing from the circle.

### Tooltips

`--color-tooltip-bg` fill, `--color-tooltip-text` text, 12px corners. Inter 12px 500, 6px vertical and 10px horizontal padding, 240px max width, 6px arrow, 300ms delay, top position by default.

## Do's And Don'ts

- Do use pipeline stage colors consistently across kanban boards, tables, and reports.
- Do visually distinguish deal card states with left border color to encode stage at a glance.
- Do highlight overdue tasks and stale deals with the tertiary orange, never with red.
- Do show deal count and total value in every pipeline stage header.
- Don't use more than four pipeline stages visible simultaneously without horizontal scrolling.
- Don't display monetary values without proper currency formatting and locale awareness.
- Don't animate deal card transitions longer than 200ms; speed conveys confidence.
- Don't mix kanban and list views on the same page. Let users toggle between modes instead.
