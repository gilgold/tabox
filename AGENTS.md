# Tabox - Codex Guide

## Project Overview

Tabox is a Chrome/Edge extension (Manifest v3) for saving open tabs and tab groups into named collections. Users can organize collections into folders, export/import them, and optionally sync across devices via Google Drive.

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
  api-keys.json       # API keys (gitignored — see setup below)
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
2. Copy API keys into `chrome/api-keys.json` (gitignored):
   ```json
   {
     "googleDrive": "<GOOGLE_API_KEY>",
     "clientSecret": "<CLIENT_SECRET>"
   }
   ```
3. `yarn dev` to start watch mode
4. Load the `build/` folder as an unpacked extension in `chrome://extensions` (enable Developer mode)

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
- **`STORAGE_KEYS` is duplicated in THREE files that MUST stay in sync**: `app/utils/sharedConstants.js`, `chrome/background-utils.js`, and `chrome/sync-apply.js`. `sharedConstants.test.js` enforces the key set.
- **Deletions propagate via tombstones, not absence.** Keys: `deleted_collection_tombstones`, `deleted_folder_tombstones`. Adding a new deletable entity type requires wiring the tombstone through the *entire* pipeline: mark on delete + clear on save (`storageUtils.js`), include in the upload payload (`prepareSyncDataForUpload` in `background-utils.js`), merge/apply/serialize (`sync-merge.js`), and persist + add to `SYNC_MANAGED_KEYS` (`sync-apply.js`). The timestamp heuristic in `resolveSingleSidedEntity` is only an unreliable fallback — without a tombstone a deleted entity gets resurrected (or its deletion is dropped) on the other device.
- **Merge timestamp semantics**: the local snapshot fed to `mergeSyncSnapshots` must carry the persisted `localTimestamp` (real last-local-change time), **not** `Date.now()`. Using `Date.now()` makes the single-sided-deletion heuristic treat every brand-new remote entity as a local deletion and drop it.
- **Both devices must run the same extension version** for sync to converge — a device on an older build that lacks a tombstone type (or a merge fix) produces the asymmetric "folder lingers empty / item resurrects" symptoms. When debugging "X doesn't sync", confirm the build/version on *both* devices first.

### MV3 service-worker constraints (sync reliability)
- **Always `await triggerBackgroundSync()`** in operations that mutate then sync (folder create/update/delete/duplicate/move). Fire-and-forget returns before the `updateRemote` message is dispatched, and the SW/popup can tear down before the round-trip completes → the sync is lost.
- **Do not defer sync work to a standalone `setTimeout`** in the service worker — it can be discarded when the worker goes idle. Keep the triggering message handler awaiting the work instead. (This is why `chrome/sync-throttle.js` coalesces overlapping syncs into an awaited trailing run rather than scheduling a timer, and must never silently drop a sync.)

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

- `chrome/api-keys.json` is gitignored — never commit real API keys
- CI injects API keys via secrets during build
- The extension targets Chrome 89+ (Manifest v3)
- Webpack splits vendor chunks (React, UI libs, dnd-kit)
- Release builds strip `console.log` via Terser
- After any code change, always run `yarn prod` before considering the work complete
