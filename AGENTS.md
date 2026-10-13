# Tabox - Codex Guide

## Project Overview

Tabox is a browser extension (Manifest v3) for Chromium browsers (Chrome/Edge) **and Firefox**, for saving open tabs and tab groups into named collections. Users can organize collections into folders, export/import them, and optionally sync across devices via Google Drive.

## Browser Support (Chromium + Firefox) — applies to EVERY change

**Any code change must work on both Chromium (Chrome/Edge) and Firefox.** This is a hard requirement, not a nice-to-have. It applies to scripts (popup, service worker/background, content), CSS rendering, manifest changes, and any browser API usage.

- **APIs**: use the `browser.*` namespace via webextension-polyfill, never bare `chrome.*` in new code. Before using any extension API, verify it exists on Firefox (MDN browser-compat) — e.g. `chrome.tabGroups`, `chrome.identity.getAuthToken`, and offscreen documents are Chromium-only or behave differently; gate them with feature detection and provide a Firefox path (e.g. Firefox OAuth goes through `launchWebAuthFlow` bridged by the Worker's `GET /auth/start`).
- **Background context**: Chromium runs an MV3 service worker; Firefox may run an event page/background script. Don't rely on SW-only globals (`importScripts`, `clients`, etc.) without a Firefox-compatible equivalent or guard.
- **CSS**: verify rendering in both engines (Blink and Gecko). Avoid Chromium-only features without fallbacks (`-webkit-` prefixed rules need unprefixed/`-moz-` equivalents; check scrollbar styling, `zoom`, popup sizing behavior, and form-control styling which differ in Gecko).
- **Manifest**: keep Firefox-specific keys (`browser_specific_settings`, background scripts vs service_worker) in mind when touching `manifest.json`.
- **Verification**: when testing or reasoning about a change, consider both variants; don't declare work complete if it's only been validated against Chromium.
- **Firefox for Android** (listed via `gecko_android`): no `windows`, `tabGroups`, `sessions`, `commands`, `contextMenus` or `identity` APIs; every tab has its own `windowId`, `favIconUrl` is never set, and `tabs.query` only returns tabs loaded since startup (Mozilla bug 1583281). Gate UI with `app/utils/platform.js` (`isSingleWindowBrowser`, `isSupported(requires)` on registry entries) and background code with `browser.<ns>?.`. Never register a top-level listener on a possibly-missing namespace unguarded — one throw aborts every listener after it. Auto-update is disabled there (partial tab lists would destroy collections); sign-in uses the tab flow (`startTabAuthFlow` → Worker `/auth/done` → top-level `tabs.onUpdated`, since the event page is suspended mid-flow); the toolbar entry always opens the full page.

## Tech Stack

- **UI**: React 19, Jotai (state management), CSS (no preprocessor)
- **Language**: JavaScript (ES2020+, JSX) — no TypeScript
- **Build**: Webpack 5, Babel 7
- **Tests**: Jest 29, React Testing Library
- **Lint**: ESLint 9 (eslint:recommended + react plugin)
- **Package Manager**: Yarn 3.6.4 (Berry)
- **CI/CD**: CircleCI — builds, tests, and publishes to Chrome Web Store on main

## Common Commands

```bash
yarn install          # Install dependencies
yarn dev              # Dev build with watch mode
yarn build            # Production build
yarn prod             # Required post-change production build verification
yarn build:release    # Optimized release (no sourcemaps, no console logs)
yarn build:debug      # Production with source maps
yarn test             # Run all tests with coverage
yarn lint             # ESLint check
yarn clean            # Remove build/ and .cache/
```

## Project Structure

```
app/                  # React application
  atoms/              # Jotai atoms (global state)
  model/              # Data models (TaboxCollection, TaboxFolder)
  utils/              # Utilities (storage, migration, validation, backup)
  App.js              # Root component
  *.js / *.css        # Components with co-located styles
chrome/               # Extension files
  manifest.json       # Manifest v3
  background.js       # Service worker
  background-utils.js # Background script helpers
static/               # Entry points and static assets
  index.js            # React entry point
  index.html          # Popup HTML template
  index.css           # Global styles
  globals.js          # Browser API globals
tests/                # Jest test files
__mocks__/            # Jest mocks
build/                # Webpack output (gitignored)
webpack.js            # Webpack config
.codex/skills/        # Project-local Codex skills
```

## Project Skills

- `sora`: Project-local Codex skill bundle at `.codex/skills/sora/`
- Use it for Sora video generation and asset management workflows tied to Tabox demos or marketing assets
- Requires `OPENAI_API_KEY` and Sora API access for live runs

## Development Setup

1. `yarn install`
2. `yarn dev` to start watch mode
3. Load the `build/` folder as an unpacked extension in `chrome://extensions` (enable Developer mode)

No API keys are bundled with the extension. All secrets live only as wrangler secrets on the Cloudflare Worker (`server/`): Google OAuth token exchanges go through `POST /auth/token` (secret `GOOGLE_CLIENT_SECRET`).

## Architecture

### Extension Entry Points
- **Popup UI** (`static/index.js` → `app/App.js`): React app rendered in the extension popup
- **Service Worker** (`chrome/background.js`): Handles tab events, context menus, keyboard commands, auto-updates, and Google Drive sync
- **Sandbox** (`static/deferedLoading.html`): Isolated context for safe data loading/imports

### Storage
- Indexed storage system in `app/utils/storageUtils.js`
- Keys: `collections_index`, `folders_index`, `collection_<uid>`, `folder_<uid>`
- Versioned with `CURRENT_STORAGE_VERSION` for migrations (`app/utils/migrationCoordinator.js`)
- **Never run per-item collection storage ops in parallel** (e.g. `Promise.all` of `deleteSingleCollection`/`saveSingleCollection`). They each read-modify-write the shared `collections_index`, so concurrent calls lose updates and leave stale index entries pointing at removed records. Use the atomic batch helpers (`batchDeleteCollections`, `batchUpdateCollections`) which do a single index pass.

### State Management
- Jotai atoms in `app/atoms/` for global state (theme, sync status, search, settings)
- Local `useState` for component-specific state
- `useCollectionOperations` hook for collection CRUD operations

### Communication
- Popup ↔ Background: `browser.runtime.sendMessage()` via webextension-polyfill

### Sync subsystem (read before touching sync — it is subtle and has regressed repeatedly)
- **Flow**: UI triggers a sync via `triggerBackgroundSync()` (`app/utils/sharedSync.js`) or `App._update()` → sends an `updateRemote` message → background `handleRemoteUpdate()` → `syncData()`. `syncData` either does a full download (`_loadSettingsFile`) or, when local/remote timestamps are within ~60s (the "conflict window"), a three-way merge via `mergeSyncSnapshots()`. Uploads go through `uploadPreparedSyncData()` (a blind PATCH overwrite — it does **not** merge), and incoming data is applied atomically via `applySyncSnapshotAtomically()`.
- **Pure, testable sync modules**, loaded by `background.js` via `importScripts` and dual-exported (`globalThis.*` + `module.exports`), each with a `*.module.test.js`: `chrome/sync-merge.js`, `sync-apply.js`, `sync-throttle.js`, `sync-transport.js`, `sync-session-state.js`. Prefer adding logic here (unit-testable) over inlining in `background.js`.
- **`STORAGE_KEYS` is duplicated in FOUR files that MUST stay in sync**: `app/utils/sharedConstants.js`, `chrome/background-utils.js`, `chrome/sync-apply.js`, and `chrome/ai-storage.js`. `sharedConstants.test.js` enforces the key set.
- **Deletions propagate via tombstones, not absence.** Keys: `deleted_collection_tombstones`, `deleted_folder_tombstones`. Adding a new deletable entity type requires wiring the tombstone through the *entire* pipeline: mark on delete + clear on save (`storageUtils.js`), include in the upload payload (`prepareSyncDataForUpload` in `background-utils.js`), merge/apply/serialize (`sync-merge.js`), and persist + add to `SYNC_MANAGED_KEYS` (`sync-apply.js`). The timestamp heuristic in `resolveSingleSidedEntity` is only an unreliable fallback — without a tombstone a deleted entity gets resurrected (or its deletion is dropped) on the other device.
- **Merge timestamp semantics**: the local snapshot fed to `mergeSyncSnapshots` must carry the persisted `localTimestamp` (real last-local-change time), **not** `Date.now()`. Using `Date.now()` makes the single-sided-deletion heuristic treat every brand-new remote entity as a local deletion and drop it.
- **Both devices must run the same extension version** for sync to converge — a device on an older build that lacks a tombstone type (or a merge fix) produces the asymmetric "folder lingers empty / item resurrects" symptoms. When debugging "X doesn't sync", confirm the build/version on *both* devices first.

### MV3 service-worker constraints (sync reliability)
- **Always `await triggerBackgroundSync()`** in operations that mutate then sync (folder create/update/delete/duplicate/move). Fire-and-forget returns before the `updateRemote` message is dispatched, and the SW/popup can tear down before the round-trip completes → the sync is lost.
- **Do not defer sync work to a standalone `setTimeout`** in the service worker — it can be discarded when the worker goes idle. Keep the triggering message handler awaiting the work instead. (This is why `chrome/sync-throttle.js` coalesces overlapping syncs into an awaited trailing run rather than scheduling a timer, and must never silently drop a sync.)

### Command palette (popup ↔ full-page parity)
- The command palette (`app/CommandPalette.js`, opened with Ctrl/⌘+K) renders in **both** the popup and the full-page view. **Keep them at full parity:** whenever you add a setting or a user-facing action, register it in the shared command-palette registries so it appears in both views. The registries: `EXTENSION_ACTIONS` (global actions), `SETTINGS_TOGGLES` (settings), `COLLECTION_SUB_ACTIONS` (per-collection actions), and `AI_ACTIONS` (AI Tools modal actions, built from the canonical `AI_TOOLS` in `app/ai/aiTasks.js`).
- View-specific behavior is gated by `isFullPage` (`viewContextState`). Only differ between views when a feature is inherently view-bound (e.g. `open-fullpage` is hidden in full-page); a new setting/action is **not** a valid reason to diverge.
- AI Tools modal actions open `AIToolsModal` pre-navigated to a tool via the `aiToolsInitialToolState` atom (App's `cmdOpenAiTool` → `onOpenAiTool` prop). Add a new AI tool to `AI_TOOLS` and it should also get an `AI_ACTIONS` keyword entry so it surfaces in the palette.

### AI tasks (MUST run in the service worker)
- AI features use Google Gemini 3.5 Flash Lite via OpenRouter, proxied through the Tabox Worker's `POST /ai/complete` (`server/src/aiProxy.js`) — the extension never holds the OpenRouter key, and the model/max_tokens are pinned server-side. `chrome/ai-client.js` (service worker) calls the Worker with `getAuthToken()`; `app/ai/aiClient.js` (popup) relays through the SW via the `aiComplete` message — keep the two session interfaces in sync. Tabox AI works in every Chromium browser but requires being signed in to Tabox (availability `'sign-in-required'`).
- **Every AI task's long-running work must execute in the service worker** (`chrome/background.js` / `background-utils.js`), driven by `browser.runtime.sendMessage` from the popup — so closing the popup does NOT abort it. The popup only initiates the task, observes progress, and renders results; it is a detachable observer, never the owner of the work.
- Persist progress/state to `chrome.storage.local` (like `SMART_ORGANIZE_UNDO_KEY` / `AUTO_ARRANGE_UNDO_KEY`) so a reopened popup can reattach and re-render progress. Push updates back via messages / `storage.onChanged`.
- Follow the existing `smartOrganizeApply` handler (`background-utils.js` ~line 1067) as the reference pattern. Respect the MV3 SW constraints above: keep the message handler awaiting the work; never defer it to a standalone `setTimeout` (the worker can be discarded).
- Fast one-shot suggestions (suggest collection/folder name) are exempt; anything that loops over multiple collections/tabs is not.
- **Existing tasks still running inline in the popup (must be migrated):** Auto-Rename Collections, Auto-Arrange into Folders, and Smart Organize *planning*.

### Sync UI feedback
- The "Syncing…" indicator (Header/Footer) is driven by the `syncInProgressState` Jotai atom. `App._update()` toggles it; plain `triggerBackgroundSync()` does **not**. Operations that trigger their own sync should use the `useTrackedSync()` hook (`app/useTrackedSync.js`) so the indicator reflects the sync.
- **Show success/undo toasts immediately**, before awaiting the (multi-second) sync round-trip — do the local mutation, show the toast, then await the tracked sync. Pass `{ skipSync: true }` to the op (e.g. `deleteFolder`) so the caller controls sync timing.

## Code Conventions

- **Files**: PascalCase for components (`CollectionList.js`), camelCase for utilities (`storageUtils.js`)
- **Variables**: camelCase; constants: UPPER_SNAKE_CASE
- **CSS classes**: kebab-case
- **Components**: One per file, functional components with hooks
- **Styling**: Co-located CSS files (e.g., `CollectionList.js` + `CollectionList.css`)
- **No prop-types** — disabled in ESLint
- **No Prettier** — ESLint only
- **Tooltips**: NEVER use the native `title` attribute for tooltips. Always use the shared rich tooltip (`react-tooltip`): put `data-tooltip-id="main-tooltip"` + `data-tooltip-content="…"` (optionally `data-tooltip-class-name="small-tooltip"`) on the anchor element. The global `<Tooltip id="main-tooltip">` instance lives in `app/App.js` (portaled to `document.body`, theme-aware, `whiteSpace: pre-line`). Native `title` is unstyled, theme-blind, and slow to appear.
- **Marketing typography, wordmark, and slogan**: Use **Comfortaa for every marketing-text element** in branded marketing/store artwork. Render the `Tabox` title in a single solid color only (white on dark backgrounds; black/near-black on light backgrounds); never apply the brand gradient to the `Tabox` title. Place the slogan `Organize Beautifully` directly beneath the `Tabox` title in the logo lockup, beside the icon—not as a separate eyebrow elsewhere in the composition. Apply the gradient to the slogan text itself, ordered **purple → blue → orange** (for example `#8B5DFF → #1698E2 → #FF8C42`).
- **Locked Chrome Web Store screenshot system**: Keep the clean midnight gradient, enlarged top-left logo lockup, large white headline, restrained supporting copy, Comfortaa typography, and Tabox purple/blue/orange accents. The straight dark-mode UI and standalone icon + word row belong to the first screenshot only; do not repeat either device in later screenshots. Screenshots after the first use ImageGen-produced campaign illustration backgrounds with the exact branding and copy composited deterministically on top. Each feature needs a distinct main metaphor; the two Pro screens must be visually unrelated (sharing = human collaboration around a shared folder, AI = abstract intelligence transforming tabs, with no people/shared-folder scene). Do not repeat a three-highlight row. Do not add a bottom collection/tab count card. For Pro screenshots, use a large standalone corner `Tabox PRO` wordmark with no frame, pill, badge background, border, or container styling: solid-white `Tabox` and gradient `PRO`. Include `Starting at just 4.99$* a month!` and visibly readable fine print `* billed annually`.

## Testing

- Tests in `tests/` directory with `.test.js` suffix
- Chrome extension APIs mocked via `jest-webextension-mock`
- Additional mocks in `__mocks__/` and `jest.setup.js`
- Run: `yarn test`

## Development Directives

- Use a TDD workflow for new features and extensions to existing features: write or update the tests first so they capture the intended requirement, then implement the change and do not consider the work complete until the relevant tests are green.
- Before adding new logic, check whether the codebase already has an existing function, utility, hook, or helper that covers the capability or can be extended safely. Prefer reuse and extension over duplicating behavior.
- In the UI, prefer shared React components and extend existing layout/control patterns when areas behave similarly. Avoid writing new UI code from scratch when an existing shared element can be reused or adapted.
- If changing the data structure for collections, tabs, or folders, also update and verify the export, import, and sharing flows so those formats and features continue to reflect the new structure correctly.

## Important Notes

- The extension bundle carries NO credentials — Google OAuth token exchanges run on the Worker (`POST /auth/token`, wrangler secret `GOOGLE_CLIENT_SECRET`)
- The extension targets Chrome 89+ (Manifest v3) and Firefox — every change must work on both (see Browser Support section)
- Webpack splits vendor chunks (React, UI libs, dnd-kit)
- Release builds strip `console.log` via Terser
- After any code change, always run `yarn prod` before considering the work complete
- Marketing site & pricing page: **tabox.co is a Next.js app on Vercel** (`~/Projects/tabox-homepage`, deploys on push to its `main`) — the old Wix site is retired and this repo's `site/pricing/` builder has been deleted. The live Paddle checkout lives in that repo's `app/pro/ProPricing.js` (live client token + the four `pri_` ids, trial vs no-trial chosen from the Worker's `GET /checkout/eligibility`); keep those ids in sync with `server/wrangler.toml`. No manual copy-paste step exists any more.

## Git & Registry Rules

- **Git identity**: this project must use the **gilgold** GitHub account — never **gil-wix**. Before ANY git action (commit, push, PR via `gh`), verify `git config user.name` / `user.email` and `gh auth status` resolve to gilgold; fix the repo-local config / `gh auth switch` first if not.
- **npm registry**: this machine installs through the Wix internal npm registry, but Wix registry URLs must NEVER reach the remote. Before any push, check staged changes (`yarn.lock`, `.npmrc`, `.yarnrc.yml`) for Wix registry hostnames (e.g. `wixpress`) and replace them with public npm registry URLs (`registry.npmjs.org` / `registry.yarnpkg.com`).
