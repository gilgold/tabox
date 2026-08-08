# Firefox smoke test harness

Proves the Firefox build (`build-firefox/`, produced by `yarn build:firefox`)
actually boots and renders in **real Firefox** — not a headless/Chromium
stand-in. Playwright cannot load Firefox extensions, so this uses
[selenium-webdriver](https://www.npmjs.com/package/selenium-webdriver) +
[geckodriver](https://www.npmjs.com/package/geckodriver) instead, driving the
Firefox app at `/Applications/Firefox.app`.

## Running

```bash
bash e2e-firefox/run.sh
```

This will:

1. Run `yarn build:firefox` if `build-firefox/` doesn't exist yet.
2. Install `selenium-webdriver` and `geckodriver` into a throwaway `npm`
   prefix (a `mktemp -d` directory) — **not** into this project's
   `package.json`/`yarn.lock`. `smoke.cjs` picks them up via `NODE_PATH`.
3. Zip `build-firefox/` into a temporary `.xpi` (zipped from inside the
   directory so `manifest.json` lands at the archive root).
4. Launch headless Firefox, install the `.xpi` as a temporary add-on,
   and assert:
   - the popup (`index.html`) boots and the React app renders,
   - the background event page is alive (answers a real
     `browser.runtime.sendMessage`),
   - the full-page view (`fullpage.html`) boots and renders.
5. Print a PASS/FAIL summary and exit non-zero on any failure.

Env overrides:

- `FIREFOX_BINARY` — path to a different Firefox binary.
- `HEADFUL=1` — run with a visible window instead of headless (useful when
  debugging locally).

On any check failure, a screenshot and page source are written to a
`tabox-firefox-smoke-*` directory under the OS temp dir; the path is printed
to stderr.

## Why not Playwright?

Playwright's Firefox channel is a custom-patched build and does not support
loading unpacked/temporary WebExtensions the way Chrome/Chromium does. Real
Firefox + `selenium-webdriver`/`geckodriver` is the standard way to drive an
actual extension install in Firefox.

## The `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` gotcha

Recent Firefox builds refuse to `WebDriver:Navigate` to privileged URL
schemes (`moz-extension://`, `about:*` beyond `about:blank`, `chrome://`)
unless the environment variable `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` is set
before Firefox starts (see `RemoteAgent.sys.mjs` /
`marionette/driver.sys.mjs` — `allowSystemAccess`). Without it, navigating to
the popup or full-page URL fails with:

```
UnsupportedOperationError: Navigation to "moz-extension://<uuid>/index.html" is not allowed in this context
```

`run.sh` sets this env var for you. If you invoke `smoke.cjs` directly for
debugging, set it yourself.

## How the extension's internal UUID is discovered

Firefox assigns a random per-profile UUID for `moz-extension://` URLs on
install, recorded in the profile's `prefs.js` under
`extensions.webextensions.uuids`, keyed by the extension's `gecko.id`
(`tabox@tabox.co`, set in `chrome/buildManifest.js`). `smoke.cjs` reads the
`moz:profile` WebDriver capability to locate the profile directory, then
polls `prefs.js` briefly after installing the add-on (the pref write can lag
the install by a beat) until the UUID for `tabox@tabox.co` shows up.

## Background-alive check

The popup page executes `browser.runtime.sendMessage({ type:
'checkSyncStatus' })` from its own extension context (this works — it's an
extension page, not a restricted content script) and asserts the response is
literally `false`, matching `chrome/background.js`'s early-return path when
no Google credentials are stored. Getting that exact value back means the
background event page's script list loaded and its message listener is
live — not just that the popup rendered.

## Files

- `smoke.cjs` — boot smoke test: popup renders, full page renders,
  background event page answers a message.
- `journey.cjs` — functional save/restore journey: creates a window with a
  real Firefox tab group, saves it as a collection through the extension's
  real storage path, then restores that collection into a fresh window and
  verifies the tab group and tabs come back. See the comment at the top of
  the file for exactly which message types/functions this drives and why.
- `run.sh` — build-if-needed + dependency staging + runs both scripts,
  aggregating their exit codes (non-zero if either fails).

Both scripts are CommonJS (`.cjs`) so they can `require()` the
throwaway-installed deps via `NODE_PATH` — Node's ESM resolver does not
honor `NODE_PATH`.

## Known gap surfaced by `journey.cjs`

`journey.cjs` currently reports one failing check: restoring a saved
collection into a new window leaves one extra blank tab behind on Firefox
(4 tabs instead of the expected 3). Root cause: `chrome/background.js:975`'s
`isNewWindow()` only recognizes Chrome's new-tab URL shape
(`url.indexOf('://newtab') > 0`); Firefox's default new-window tab
(`about:home` / `about:blank`) never matches that substring, so the
first-tab-reuse optimization never fires on Firefox. This is a real
Firefox-port bug, not a harness issue — flagged here rather than fixed, per
the project's task boundaries for this harness.
