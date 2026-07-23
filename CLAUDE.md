# Tabox - Claude Code Guide

## Project Overview

Tabox is a Chrome/Edge extension (Manifest v3) for saving open tabs and tab groups into named collections. Users can organize collections into folders, export/import them, and optionally sync across devices via Google Drive.

## Tech Stack

- **UI**: React 19, Jotai (state management), CSS (no preprocessor)
- **Language**: JavaScript (ES2020+, JSX) — no TypeScript
- **Build**: Webpack 5, Babel 7
- **Tests**: Jest 29, React Testing Library
- **Lint**: ESLint 9 (eslint:recommended + react plugin)
- **Package Manager**: Yarn 3.6.4 (Berry)
- **CI/CD**: GitHub Actions (.github/workflows/release.yml) — lints and tests on every push/PR; builds and publishes to the Chrome Web Store and Microsoft Edge Add-ons on merge to main

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
```

## Development Setup

1. `yarn install`
2. Copy API keys into `chrome/api-keys.json` (gitignored):
   ```json
   {
     "googleDrive": "<GOOGLE_API_KEY>",
     "clientSecret": "<CLIENT_SECRET>"
   }
   ```
   The OpenRouter key (Tabox AI) is NOT stored here and must never ship in the extension bundle — it lives only as the `OPENROUTER_API_KEY` secret on the Cloudflare Worker (`server/`), which proxies all AI calls via `POST /ai/complete`.
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

### State Management
- Jotai atoms in `app/atoms/` for global state (theme, sync status, search, settings)
- Local `useState` for component-specific state
- `useCollectionOperations` hook for collection CRUD operations

### Communication
- Popup ↔ Background: `browser.runtime.sendMessage()` via webextension-polyfill

### Command palette (popup ↔ full-page parity)
- The command palette (`app/CommandPalette.js`, opened with Ctrl/⌘+K) renders in **both** the popup and the full-page view. **Keep them at full parity:** whenever you add a setting or a user-facing action, register it in the shared command-palette registries so it appears in both views. The registries: `EXTENSION_ACTIONS` (global actions), `SETTINGS_TOGGLES` (settings), `COLLECTION_SUB_ACTIONS` (per-collection actions), and `AI_ACTIONS` (AI Tools modal actions, built from the canonical `AI_TOOLS` in `app/ai/aiTasks.js`).
- View-specific behavior is gated by `isFullPage` (`viewContextState`). Only differ between views when a feature is inherently view-bound (e.g. `open-fullpage` is hidden in full-page); a new setting/action is **not** a valid reason to diverge.
- AI Tools modal actions open `AIToolsModal` pre-navigated to a tool via the `aiToolsInitialToolState` atom (App's `cmdOpenAiTool` → `onOpenAiTool` prop). Add a new AI tool to `AI_TOOLS` and it should also get an `AI_ACTIONS` keyword entry so it surfaces in the palette.

### AI tasks (MUST run in the service worker)
- AI features use DeepSeek V4 Flash via OpenRouter, proxied through the Tabox Worker's `POST /ai/complete` (`server/src/aiProxy.js`) — the extension NEVER holds the OpenRouter key. The Worker authenticates the caller's Google token, rate-limits per user, and pins the model/max_tokens server-side. `chrome/ai-client.js` (SW) calls the Worker with `getAuthToken()`; `app/ai/aiClient.js` (popup) relays through the SW via the `aiComplete` message — keep the two session interfaces in sync. Tabox AI works in every Chromium browser but requires being signed in to Tabox (availability `'sign-in-required'`).
- **Every AI task's long-running work must execute in the service worker** (`chrome/background.js` / `background-utils.js`), driven by `browser.runtime.sendMessage` from the popup — so closing the popup does NOT abort it. The popup only initiates the task, observes progress, and renders results; it is a detachable observer, never the owner of the work.
- Persist progress/state to `chrome.storage.local` (like `SMART_ORGANIZE_UNDO_KEY` / `AUTO_ARRANGE_UNDO_KEY`) so a reopened popup can reattach and re-render progress. Push updates back via messages / `storage.onChanged`.
- Follow the existing `smartOrganizeApply` handler (`background-utils.js`) as the reference pattern. Respect MV3 SW constraints: keep the message handler awaiting the work; never defer it to a standalone `setTimeout` (the worker can be discarded).
- Fast one-shot suggestions (suggest collection/folder name) are exempt; anything that loops over multiple collections/tabs is not.
- **Existing tasks still running inline in the popup (must be migrated):** Auto-Rename Collections, Auto-Arrange into Folders, and Smart Organize *planning*.

## Code Conventions

- **Files**: PascalCase for components (`CollectionList.js`), camelCase for utilities (`storageUtils.js`)
- **Variables**: camelCase; constants: UPPER_SNAKE_CASE
- **CSS classes**: kebab-case
- **Components**: One per file, functional components with hooks
- **Styling**: Co-located CSS files (e.g., `CollectionList.js` + `CollectionList.css`)
- **No prop-types** — disabled in ESLint
- **No Prettier** — ESLint only
- **Tooltips**: NEVER use the native `title` attribute for tooltips. Always use the shared rich tooltip (`react-tooltip`): put `data-tooltip-id="main-tooltip"` + `data-tooltip-content="…"` (optionally `data-tooltip-class-name="small-tooltip"`) on the anchor element. The global `<Tooltip id="main-tooltip">` instance lives in `app/App.js` (portaled to `document.body`, theme-aware, `whiteSpace: pre-line`). Native `title` is unstyled, theme-blind, and slow to appear.

## Testing

- Tests in `tests/` directory with `.test.js` suffix
- Chrome extension APIs mocked via `jest-webextension-mock`
- Additional mocks in `__mocks__/` and `jest.setup.js`
- Run: `yarn test`

## Important Notes

- `chrome/api-keys.json` is gitignored — never commit real API keys
- CI recreates chrome/api-keys.json from GitHub repository secrets during build
- The extension targets Chrome 89+ (Manifest v3)
- Webpack splits vendor chunks (React, UI libs, dnd-kit)
- Release builds strip `console.log` via Terser
- After any code change, always run `yarn prod` before considering the work complete

## Git & Registry Rules

- **Git identity**: this project must use the **gilgold** GitHub account — never **gil-wix**. Before ANY git action (commit, push, PR via `gh`), verify `git config user.name` / `user.email` and `gh auth status` resolve to gilgold; fix the repo-local config / `gh auth switch` first if not.
- **npm registry**: this machine installs through the Wix internal npm registry, but Wix registry URLs must NEVER reach the remote. Before any push, check staged changes (`yarn.lock`, `.npmrc`, `.yarnrc.yml`) for Wix registry hostnames (e.g. `wixpress`) and replace them with public npm registry URLs (`registry.npmjs.org` / `registry.yarnpkg.com`).
