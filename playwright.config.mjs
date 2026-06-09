import { defineConfig } from '@playwright/test';

// E2E (UI) tests for the extension run against the built, unpacked extension in `build/`.
// Run `yarn prod` (or `yarn build`) before `yarn test:e2e` so `build/manifest.json` exists.
export default defineConfig({
  testDir: './e2e',
  // Chrome extensions load into a persistent context — keep it single-threaded.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    // crxbox option fixture: directory containing the extension's manifest.json.
    extensionPath: './build',
    trace: 'on-first-retry',
    // Opt-in pacing for watching a headed run: `SLOWMO=800 yarn test:e2e:headed`.
    // Off by default so normal/CI runs stay fast.
    launchOptions: { slowMo: Number(process.env.SLOWMO) || 0 },
    // Pin popup.open() to Tabox's real action-popup width (static/index.css → 670px) so
    // layout-sensitive assertions match production rather than a full browser viewport.
    popupViewport: { width: 670, height: 600 },
  },
});
