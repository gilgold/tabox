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

## Important Notes

- `chrome/api-keys.json` is gitignored — never commit real API keys
- CI recreates chrome/api-keys.json from GitHub repository secrets during build
- The extension targets Chrome 89+ (Manifest v3)
- Webpack splits vendor chunks (React, UI libs, dnd-kit)
- Release builds strip `console.log` via Terser
- After any code change, always run `yarn prod` before considering the work complete
