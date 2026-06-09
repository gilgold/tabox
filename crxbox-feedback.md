# crxbox — feedback log (from testing with Tabox)

This file tracks issues, rough edges, and suggestions for **crxbox** (a Chrome-extension
testing framework, in active development) discovered while adopting it in the **Tabox**
extension. Each entry should include a description, severity/type, concrete evidence
(logs, code, versions), and a suggested fix.

## Environment

| Thing | Value |
|-------|-------|
| crxbox | `0.0.0` (local checkout at `/Users/gilgo/Projects/crxbox`, consumed via `file:` tarball) |
| @playwright/test | `1.60.0` |
| Chromium | rev `1223` (matches playwright-core 1.60.0) |
| Node | `v26.0.0` |
| Yarn | `4.12.0` (Berry, `nodeLinker: node-modules`) |
| Host project | Tabox — Manifest v3, React 19, `package.json` `type: commonjs` |
| Extension under test | built to `./build` (`yarn prod`), `manifest.json` `action.default_popup: index.html` |

Legend: 🔴 blocker · 🟠 friction · 🟢 positive · 💡 suggestion

---

## 1. 🔴 Consuming crxbox via a live symlink/portal causes "Requiring @playwright/test second time"

**Type:** blocker / packaging · **Status:** worked around (see §2 of resolution)

### What happens
crxbox declares `@playwright/test` as a `peerDependency` (correct) but also has it
installed in its own `node_modules` (as a devDependency, needed for crxbox's own tests).
When a consumer links crxbox **as a live symlink** (yarn `portal:` or `link:`) pointing at
the crxbox dev checkout, Node resolves crxbox's `import "@playwright/test"` to crxbox's
*own* nested copy — so the test process loads two distinct `@playwright/test` module
instances (the consumer's and crxbox's). Playwright hard-fails on this.

### Evidence
With `crxbox` linked via `portal:/Users/gilgo/Projects/crxbox`:

```
Error: Requiring @playwright/test second time,
First:
    at Object.<anonymous> (/Users/gilgo/Projects/tabox/node_modules/playwright/lib/index.js:70:33)
    ...
Second:
    at Object.<anonymous> (/Users/gilgo/Projects/tabox/node_modules/playwright/test.js:17:13)
    at Object.<anonymous> (/Users/gilgo/Projects/crxbox/node_modules/playwright/lib/index.js:65:11)
    at Object.<anonymous> (/Users/gilgo/Projects/crxbox/node_modules/playwright/test.js:17:13)
Error: No tests found
```

The two import sites are the smoking gun: one under `tabox/node_modules`, one under
`crxbox/node_modules`.

crxbox's bundle imports Playwright at module top-level, so *any* import from crxbox
triggers this — there is no "import only the fixtures" escape:

```
$ grep -nE '^import' /Users/gilgo/Projects/crxbox/dist/index.js
2:import { test as base, expect as baseExpect2 } from "@playwright/test";
5:import { chromium } from "@playwright/test";
362:import { expect as baseExpect } from "@playwright/test";
```

### What we tried
- `NODE_OPTIONS=--preserve-symlinks` (yarn even *warns* `YN0072: portals … require the
  --preserve-symlinks Node option`). This changed the resolution path but crxbox's own
  `node_modules` still shadowed:
  ```
  Second:
      at .../tabox/node_modules/crxbox/node_modules/playwright/lib/index.js:65:11
  ```
- Empirically confirmed the root cause: temporarily moving
  `crxbox/node_modules/{@playwright,playwright,playwright-core}` aside made the test pass
  immediately (with `--preserve-symlinks`). Restoring them reintroduced the failure.

### Suggestions 💡
1. **Emit a crxbox diagnostic for this case.** The raw Playwright "Requiring … second time"
   message is cryptic. A `loader/duplicate-playwright` (or similar) `CrxboxError.diagnostic.code`
   that detects two resolved `@playwright/test` paths and prints both, plus a one-line fix,
   would save a lot of time. This is the single biggest adoption papercut so far.
2. **Document the consumption contract in SKILL.md / README:** crxbox must share the
   consumer's single `@playwright/test` instance. Call out that a live symlink to a dev
   checkout that has its own `node_modules` will break, and give the supported options
   (publish to a registry; or `npm pack` → `file:` tarball; or dedupe so there is one copy).
3. Consider whether the published package can avoid bundling/needing a nested Playwright at
   runtime so symlinked consumption "just works" with `--preserve-symlinks`.

---

## 2. 🟠 ESM-only package needs explicit guidance for CommonJS host projects

**Type:** friction / docs

### What happens
crxbox is ESM-only (`"type": "module"`, `exports` only exposes `import`, no `require`).
Tabox's `package.json` is CommonJS (`type: commonjs`). Playwright, by default, transpiles
config and spec files toward CJS and `require()`s them — which fails on an ESM-only package
like crxbox. The fix was to force real ESM by naming both the config and the spec with an
ESM extension:

- `playwright.config.mjs`
- `e2e/settings-menu.spec.mjs`

With `.js` (under a CommonJS host) the import of crxbox would be attempted via `require`
and fail.

### Evidence
- crxbox `package.json`: `"type": "module"`, `exports["."]` has only `import` (no `require`).
- Confirmed crxbox loads correctly only as a true ES module:
  ```
  $ node --input-type=module -e "import('crxbox').then(m=>console.log(Object.keys(m)))"
  [ 'BackgroundHelper','ContentUi','CrxboxError','Ext','PopupHelper',
    'StorageArea','StorageHelper','createExtensionFixtures','expect','test' ]
  ```

### Suggestion 💡
Add a short "CommonJS host project" note to SKILL.md: *use `.mjs`/`.mts` for your
`playwright.config` and spec files (or set `"type": "module"`) so crxbox is loaded as ESM.*
A one-line example would prevent a confusing `ERR_REQUIRE_ESM`-class failure.

---

## 3. 🟢 Popup helper "just worked" — good DX

**Type:** positive

`ext.popup.open()` with **no argument** auto-resolved the popup path from the manifest's
`action.default_popup` (`index.html`) and returned a normal Playwright `Page`. The smoke
test below passed first try (after fixing an assertion that was ours, not crxbox's):

```js
import { test, expect } from 'crxbox';
test('opens the settings drawer from the gear button', async ({ ext }) => {
  const popup = await ext.popup.open();
  await popup.locator('.settings-button').click();
  const drawer = popup.locator('.custom-drawer.open');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
```

```
Running 1 test using 1 worker
  ✓  e2e/settings-menu.spec.mjs › opens the settings drawer from the gear button (1.0s)
  1 passed
```

Setting `extensionPath` via the Playwright config `use: {}` block (the crxbox option
fixture) also worked cleanly.

> Note: not a crxbox issue — our first version asserted `getByRole('heading', {name:'Settings'})`
> which strict-mode-matched both `<h2>Settings</h2>` and `<h3>General Settings</h3>`. Fixed
> with `exact: true`. Recorded only so the example above is accurate.

---

## 4. 🔴 crxbox ignores `headless` / `--headed` / `launchOptions` / `slowMo`

**Type:** blocker for interactive use / missing feature · **Status:** ✅ fixed in crxbox (this session)

### Fix applied
Implemented suggestion #1/#3 directly in the crxbox source:
- `src/loader.ts` — `LoadOptions` gained an optional `launchOptions?: LaunchOptions`; the
  launcher now merges it, defaulting `channel` to `'chromium'` and **appending** the caller's
  `args` to crxbox's two required extension args (instead of replacing them).
- `src/fixtures.ts` — the `context` fixture now depends on Playwright's worker-scoped
  `headless`, `channel`, and `launchOptions` (`PlaywrightWorkerOptions`) and forwards them:
  ```ts
  launchOptions: { ...launchOptions, headless, channel }
  ```
`npm run typecheck` + `npm run build` pass.

### Verification
`SLOWMO=800 yarn test:e2e:headed` now opens a visible, paced window; run time went
`1.0s → 3.3s`, confirming `slowMo` is applied. (Config reads `SLOWMO` into
`use.launchOptions.slowMo`, kept opt-in so default/CI runs stay fast.)

> Remaining: change is in the local crxbox checkout only (not yet committed/published).
> Worth adding a crxbox unit/integration test that asserts `headless`/`launchOptions` are
> forwarded, so this can't regress.

### Original report

**Type:** blocker for interactive use / missing feature · **Status:** open

### What happens
The browser launcher hardcodes its options and the `context` fixture forwards nothing from
the Playwright config, so `--headed`, `headless`, `slowMo`, `devtools`, `channel`, custom
`args`, etc. are all silently dropped. You cannot watch a run, pace it, or open devtools.

### Evidence
```js
// crxbox/dist/index.js  (launchWithExtension)
return chromium.launchPersistentContext("", {
  channel: "chromium",
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`
  ]
});                       // no `headless`, no `slowMo`, no merge of launchOptions
```
```js
// crxbox/dist/index.js  (createExtensionFixtures)
context: async ({ extensionPath, extensionKey }, use) => {
  const context = await launchWithExtension({ path: extensionPath, key: extensionKey });
  await use(context);     // Playwright's use.headless / use.launchOptions never passed in
}
```
Symptom: `yarn test:e2e` and `yarn test:e2e:headed` behave identically — both run headless
(new-headless still loads the extension, so the SW starts and the test passes), and no
window ever appears for the `--headed` run.

### Suggestions 💡
1. Forward Playwright's standard launch config from the fixture into
   `launchPersistentContext`, e.g. read the `headless`, `launchOptions`, `channel`,
   `viewport` fixtures and merge them — so `--headed`, `PWDEBUG=1`, and
   `use: { launchOptions: { slowMo } }` work as users expect.
2. At minimum, expose a crxbox option (e.g. `launchOptions` on `createExtensionFixtures` /
   the `extensionPath` config) and **merge** crxbox's required extension `args` with the
   caller's, rather than replacing them.
3. Keep the two hardcoded extension args, but `headless` should default to Playwright's
   resolved value so `--headed` is honored.

---

## 5. 🟠 `popup.open()` renders at full browser viewport, not real popup dimensions

**Type:** fidelity / DX · **Status:** open

### What happens
`ext.popup.open()` opens the popup as an ordinary tab/page, so it inherits Playwright's
default viewport (1280×720) — not the dimensions of a real Chrome action popup. In
production, Chrome sizes the action popup to its **content** (capped ~800×600, with a
minimum), so width-dependent layout, overflow/scrollbars, ellipsis truncation, fl- and
grid-wrapping, and any CSS keyed to the popup's actual width can render differently in the
test than for real users. A headed run makes this obvious: the window is a big browser tab,
not a small popup.

### Evidence
```ts
// crxbox/src/helpers/popup.ts
async open(popupPath?: string): Promise<Page> {
  const page = await this.ext.context.newPage();          // default 1280×720 viewport
  await page.goto(this.ext.url(this.resolvePopupPath(popupPath)));
  return page;                                            // no popup-sized viewport applied
}
```
Observed in `SLOWMO=800 yarn test:e2e:headed`: the Tabox popup is drawn across a full-width
browser window rather than its normal narrow popup width.

### Suggestions 💡
1. Give `open()` a popup-like default viewport (e.g. clamp to ≤ 800×600) and/or auto-size
   to the rendered content (measure `document.documentElement` scroll size after load and
   `page.setViewportSize(...)`).
2. Accept an explicit size: `ext.popup.open({ viewport: { width, height } })` (or a
   `popupSize` option on the fixture) so a project can pin its known popup width.
3. At minimum, document that `open()` is "popup-as-page" at the default viewport and that
   layout-sensitive assertions should set a viewport matching the real popup.

> For Tabox specifically: once crxbox supports it, pin the popup width to Tabox's actual
> popup dimensions so the Settings-drawer and collection-list layout match production.

---

## 6. 🟢 Storage seeding + `expect.poll` carried a full end-to-end restore test

**Type:** positive

Wrote a real flow test (`e2e/restore-backup.spec.mjs`): seed storage → open popup →
Settings → "Sync Debug & Recovery" → click Restore on an auto backup → assert collections
updated. The crxbox storage helpers made this clean:
- `ext.storage.local.set({...})` seeded a logged-in `syncSessionState`, an initial
  `collections_index` + `collection_<uid>` set, and an `autoBackups` array — all read back
  correctly by the **real service worker** (`getBackupOptions`, `recoverFromBackup`).
- `ext.storage.local.get('collections_index')` returns the **unwrapped value** (not
  `{ key: value }`), which made assertions natural: `Object.keys(await get('collections_index'))`.
- The restore writes asynchronously through the SW; `expect.poll(() => ext.storage.local.get(...))`
  handled the write-through race exactly as the SKILL's "async write-through gotcha" advises.

```
✓ e2e/restore-backup.spec.mjs › restoring an auto backup updates the stored collections (2.1s)
```

This exercised storage end-to-end with no crxbox friction. Two small doc-able notes for
crxbox (not bugs): (a) it'd help to state explicitly in SKILL.md that `get(key)` returns the
value, not a `{key: value}` wrapper; (b) seeding extension-specific "logged-in"/session
state is app-specific — a short "seed app state before `popup.open()`" example would help
newcomers.

---

## 7. 💡 No guidance/helper for `window.confirm`/`alert` dialogs in extension flows

**Type:** docs / minor DX

The full-page Recovery restore (`e2e/recovery-panel-restore.spec.mjs`) calls
`window.confirm(...)` before restoring. Playwright's default is to **dismiss** unhandled
dialogs (so `confirm()` returns `false`), which silently aborts the action — an easy footgun.
The fix is standard Playwright (`page.on('dialog', d => d.accept())`), but since
confirm/alert are extremely common in extension popups (destructive restore/delete/reset),
crxbox could help:

```js
// Required before clicking Restore, or the confirm() is auto-dismissed and restore aborts:
page.on('dialog', (dialog) => dialog.accept());
```

### Suggestions 💡
- Document the dialog gotcha in SKILL.md (it pairs naturally with the existing
  "async write-through" note).
- Optional convenience: a helper like `ext.acceptDialogs(page)` / an option to auto-accept,
  to reduce boilerplate for the common destructive-action case.

> Note: this is Playwright behavior, not a crxbox bug — logged as a DX/docs opportunity.
> (The popup's simpler SyncDebugModal restore path has no confirm, so its test needed none.)

---

## 8. 💡 No drag-and-drop helper — `@dnd-kit` needs manual pointer choreography

**Type:** missing helper / DX

Tabox reorders collections with `@dnd-kit` (PointerSensor, `activationConstraint:
{ distance: 5 }`). Playwright's `locator.dragTo()` does a single press→move→drop and does
**not** reliably trip dnd-kit's activation distance, so the drag never starts. The working
approach is raw pointer choreography with an initial nudge past the threshold and a stepped
glide (`e2e/reorder-collections.spec.mjs`):

```js
await page.mouse.move(hx, hy);
await page.mouse.down();
await page.mouse.move(hx, hy + 8);            // exceed the 5px activation distance
await page.mouse.move(tx, ty, { steps: 12 }); // glide onto the target
await page.mouse.move(tx, ty + 4, { steps: 4 }); // settle just past center
await page.mouse.up();
```

This is stable (passed `--repeat-each=5`), but it's fiddly and easy to get wrong (too-few
steps, or no nudge → silent no-op). Since extensions frequently use dnd-kit / react-dnd /
HTML5 DnD for list reordering, a crxbox helper would remove a whole class of flaky tests.

### Suggestions 💡
- Offer something like `ext.dragReorder(sourceLocator, targetLocator, { steps, nudge })`
  (or `ext.dnd(source).onto(target)`) that does the press → nudge-past-activation →
  stepped-glide → settle → release sequence, with sane defaults tuned for dnd-kit.
- At minimum, document the recipe in SKILL.md — `dragTo()` silently failing against dnd-kit
  is a very common first stumble.

### Evidence (also a Tabox note)
The popup renders collections as **list rows** (`[data-collection-uid]` + a `.handle` with
`aria-roledescription="sortable"`), not the `.collection-tile` card component
(`app/CollectionTile.js`) — that card path appears to be used elsewhere (full page). Worth
confirming the popup's list-row component is the intended one. Discovered only by dumping the
live DOM; a reminder that crxbox tests reflect *real rendered* markup, which is exactly the
value (a jsdom unit test would have asserted against the wrong component).

---

## 9. 🟢 Background/SW helpers + force-kill restart worked cleanly

**Type:** positive

`e2e/background-sw.spec.mjs` exercised the headline MV3 helpers against Tabox's real worker:
- `ext.background.sendMessage({ type: 'getBackupOptions' })` round-tripped to the SW and
  returned the grouped descriptors — sending from a real extension page "just worked".
- `ext.background.evaluate(() => chrome.runtime.getManifest().version)` → `'4.1.2'`, and a
  second `evaluate` read `chrome.storage.local` from the worker context. Clean API.
- `ext.background.kill()` then `sendMessage` / `popup.open()` correctly restarted the worker
  and served data — exactly the "assert state survives a restart" story. The SKILL's note
  ("after kill(), drive a real action to wake it") was accurate and necessary; calling a real
  action (sendMessage / opening the popup) is what triggered the restart.

This is the strongest argument for crxbox over jsdom unit tests — none of this is reachable
without a real worker.

## 10. 🟢 `toHaveStorageValue` matcher works; the single-read caveat is real

**Type:** positive / confirms a documented gotcha

Used in `e2e/delete-collection.spec.mjs`:
```js
await expect(ext.storage.local).toHaveStorageValue(
  'collections_index',
  expect.objectContaining({ 'col-b': expect.objectContaining({ name: 'Beta' }) }),
);
```
Works with `expect.objectContaining`. As the SKILL warns, it does a **single read** — Tabox's
delete is async (~400ms animation timeout before the storage write), so calling the matcher
immediately would race. Pattern that worked: `expect.poll` until the delete settled, *then*
the matcher for the final stable value. The SKILL's guidance held up; worth keeping that
caveat prominent.

## 11. 🟠 Flagship `ext.contentUi()` is not exercisable by Tabox (no content scripts)

**Type:** coverage gap / framework-testing note

crxbox's flagship helper is content-UI injection, but **Tabox has no `content_scripts`** (it's
a popup/SW extension), so `ext.contentUi(...)` cannot be tested here at all. Not a crxbox bug,
but worth flagging for the framework's own validation: a popup-only extension leaves the
single most-emphasized feature completely uncovered.

### Suggestions 💡
- Ship a tiny fixture/example extension *with* a content script in the crxbox repo so the
  flagship path has first-party coverage independent of whatever real app is adopted.
- In SKILL.md, note which helpers apply to which extension shapes (popup-only vs content-UI),
  so adopters know up front what they can/can't cover.

## 12. 🟢 `ext.storage.sync` works and is isolated from `local`

**Type:** positive

`e2e/storage-sync.spec.mjs` covered the sync area: seeded `syncFileId` into `storage.sync`,
asserted with `toHaveStorageValue` on the sync area, drove Tabox's `forceSyncReset` SW handler
(`ext.background.sendMessage`), and confirmed `syncFileId` was removed from **sync** while the
handler's local-key cleanup also happened. A second test confirmed `sync` and `local` areas
are independent (same key, different values) and that `.clear()` scopes to one area. The
per-area `get`/`set`/`clear` + auto-reset-between-tests all behaved as documented.

---

## 13. 🟢 Full-page view suite (11 tests) — crxbox handled a non-popup page cleanly

**Type:** positive + small DX suggestion

Built a full-page-view suite (`e2e/fp-*.spec.mjs`, 11 tests) covering rendering, search,
folder navigation/filtering, collection + folder drag-reorder, settings switches, card
delete/export, and create-folder. Everything ran on crxbox with no new friction:
- **Opening a non-popup extension page** worked via `context.newPage()` +
  `page.goto(ext.url('fullpage.html'))` — `ext.url()` is the right primitive.
- **Grid DnD** (`rectSortingStrategy`, distance 5) and **sidebar list DnD** (distance 6) both
  worked with the *same* pointer recipe from §8 — stable across `--repeat-each=4`.
- **Settings switches** persisted to storage (`theme`/`darkModeToggle`, `chkShowBadge`); the
  `toHaveStorageValue` matcher + `expect.poll` combo continued to work.
- **Downloads, modals, and async deletes** all behaved as in the popup specs.

A shared helper module (`e2e/support/fixtures.mjs`: seed builders, `openFullPage`,
`pointerDrag`) kept the suite DRY — note that Playwright's default `testMatch` ignores
non-`*.spec` files under `testDir`, so support modules co-locate cleanly.

### Suggestion 💡
crxbox has `ext.popup.open(path)` but no neutral helper for *other* extension pages
(full page, options page, sandbox). `ext.url()` + `context.newPage()` is fine, but a small
`ext.openPage('fullpage.html')` (newPage + goto + return Page) would read better and mirror
`popup.open()`. Minor.

---

## 14. 🟢 crxbox API gap-closure — contentUi (flagship) now exercised, plus session/identity

**Type:** positive

A dedicated gap-closure batch (`e2e/cx-*.spec.mjs`) pushed crxbox API coverage to ~95%:
- **`ext.contentUi()` flagship — now covered** without a real content script: `page.setContent`
  with a known root, then `ext.contentUi(page, { root })` correctly scoped `getByRole`/
  `getByText` into it and excluded a decoy outside the root. The failure path also works —
  a never-appearing root rejects with `CrxboxError.diagnostic.code === 'content-ui/not-injected'`.
  (Simulating the injected node is a good pattern for any extension that lacks a content
  script but wants to validate the helper.)
- **`ext.storage.session`** — set/get/clear, isolation from local/sync, and auto-reset between
  tests all verified.
- **`ext.id` / `ext.url()`** — id matches `/^[a-p]{32}$/`; `url()` builds `chrome-extension://<id>/<path>`.
- **`ext.popup.openForTab()`** — asserted the documented best-effort contract (resolves to the
  bound popup, OR throws `popup/no-active-tab`). In new-headless it took the throw path; the
  test tolerates both, so it documents the contract without flaking.

## 15. 🟠 Two testability boundaries worth documenting for crxbox adopters

**Type:** friction / docs (not bugs)

While expanding Tabox coverage, two flows turned out to be unreachable via crxbox's model —
useful to flag because they're common in extensions:

1. **"Save the current window's tabs" can't be faithfully tested.** crxbox opens the popup as
   a page (popup-as-page), so it isn't bound to a real browsing window, and the *harness's own
   pages* are the "current tabs". For a tab manager this is the headline feature, yet it can't
   be driven end-to-end. (`openForTab` is the partial answer but is best-effort/flaky.) We
   covered the equivalent save *path* via `importData` instead. → A documented recipe (or a
   helper to seed/attach a real window with known tabs) would help tab-centric extensions.
2. **Load-time data-repair migration isn't reachable by storage-seeding.** Tabox's
   `executeMigration` (color/timestamp/deferred-URL repair) is gated behind
   extension-update / storage-version flows that seeding + `popup.open()` don't trigger; bare
   pre-4.0 data is intentionally not migrated. So migration logic stays untestable from the
   consumer side without a way to simulate "the extension just updated".

---

## 16. 🟢 Feedback shipped — new helpers validated by refactoring the suite onto them

**Type:** positive (round-trip verification)

crxbox was rebuilt with the feedback changes; reinstalled it and refactored the whole suite
to use the new first-class API. **All 45 tests still pass**, confirming the helpers behave as
documented:
- **`ext.dragAndDrop(source, target, opts)`** (#8) — replaced our hand-rolled `pointerDrag`
  in the popup reorder, full-page grid reorder, sidebar folder reorder, and move-into-folder
  tests. Trips dnd-kit's distance sensors reliably (incl. the `{ nudge: 10 }` folder case).
- **`ext.openPage('fullpage.html')`** (#13) — replaced `context.newPage()` + `goto(ext.url())`
  in the shared `openFullPage` helper; all 14 full-page tests green.
- **`ext.acceptDialogs(page)`** (#7) — replaced the manual `page.on('dialog', …)` in the
  recovery restore test; the `confirm()` flow still completes.
- **`popupViewport` fixture option** (#5) — set `use: { popupViewport: { width: 670, height: 600 } }`
  in `playwright.config.mjs` (Tabox's real popup width). `popup.open()` now renders at popup
  dimensions; all popup tests still pass at that size.
- Also shipped: a `loader/duplicate-playwright` diagnostic code (#1) and `openPage`/`drag`
  diagnostics — nice closure on the original blockers.

Net: the framework absorbed essentially every actionable item from this log, and adopting the
helpers made the suite shorter and clearer (the shared `support/fixtures.mjs` no longer needs
its own drag implementation).

---

## 17. 🟢 crxbox 0.1.0 shipped the two hardest recommendations (windows/tabs + simulateUpdate)

**Type:** positive (major)

0.1.0 (first version bump) implemented the top P1 items from the assessment:
- **`ext.windows.create({ tabs, focused })` + `ext.tabs.create/query/close`** — real windows
  seeded with known tabs. Verified: `cx-windows-update.spec.mjs` seeds a 2-tab window and
  `ext.tabs.query` returns them.
- **`ext.simulateUpdate({ reason, previousVersion })`** — fires `chrome.runtime.onInstalled`.
  This **dissolved the migration testability boundary (#15.2)**: the deferred-URL repair test I
  had to *drop* now passes — `simulateUpdate` → Tabox SW sets `extensionUpdated` → popup load
  runs the update-gated migration → the wrapped URL is unwrapped.

Remaining nuance: the *"save the current window's tabs via the popup UI"* flow (#15.1) is still
gated — Tabox reads `{ currentWindow: true }` relative to the popup page's own window, so
binding the popup to a seeded window still needs `openForTab`, which is best-effort/throws in
new-headless. The foundation (windows/tabs) is now there; closing this fully needs `openForTab`
hardening or headed runs. `simulateUpdate` is also `@experimental` (version-sensitive Chromium
internal) — worked on Chromium 1223 here.

Net: trajectory is strong — every P0 and top P1 landed across iterations. The "just DIY it"
argument is weaker now that crxbox ships non-trivial extension-specific primitives.

---

## 18. 🟢 crxbox 0.2.0 — `openInWindow` dissolves the last boundary (save current tabs)

**Type:** positive (major)

`0.2.0` added **`ext.popup.openInWindow(window, popupPath?)`** — opens the popup as a tab inside
a chosen window so its `currentWindow` queries resolve there. This closed boundary **#15.1**
(the save-current-window flow I'd repeatedly called untestable):
```
✓ cx-windows-update › save-current-tabs: openInWindow lets the popup capture a seeded window's tabs (1.2s)
```
`ext.windows.create({ tabs })` → `openInWindow(win)` → "Add Collection" → Tabox saved a
collection containing the seeded tab. Smart design: sidesteps the flaky `chrome.action.openPopup`
path entirely rather than trying to harden it.

**Minor new bug:** `ext.windows.create({ tabs })` **hangs (10s) on `data:` URLs** — the tab
capture waits for a `page` event a `data:` navigation doesn't emit a match for. Works with
http(s)/extension URLs. Either support `data:`/`about:blank` seeds or document the constraint.
**→ ✅ FIXED in 0.2.1** (spike-confirmed; the save-current-tabs test now uses clean `data:`
URLs as a regression guard).

Across 0.0.0→0.2.0 crxbox closed every blocker and both testability boundaries from the
assessment. Suite now 48 tests / 23 specs, all green.

---

## Not yet exercised (coverage gaps to revisit)

- `ext.contentUi(...)` — **not possible with Tabox** (no content scripts; see §11)
- `ext.popup.openForTab(...)` (active-tab wiring) — Tabox's popup behaves the same regardless
  of active tab, so there's little to assert; low value here
- `ext.storage.session` — not used by Tabox in any observed flow
- `ext.id` / `ext.url(...)` — used implicitly; never asserted directly

Covered since the last update: storage `set`/`get` + `expect.poll` (§6), background helpers +
kill/restart (§9), `toHaveStorageValue` matcher (§10), browser downloads
(`e2e/export-download.spec.mjs`), and `storage.sync` (§12).
