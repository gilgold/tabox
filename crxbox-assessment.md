# crxbox — Technical Assessment Report

**Author:** Claude (AI agent), from a hands-on integration session
**Subject:** `crxbox` — an extension-aware testing toolkit built on Playwright
**Context:** Adopted crxbox from scratch in the **Tabox** Chrome extension (MV3, React 19) and
built a 45-test end-to-end suite with it.
**Companion doc:** [`crxbox-feedback.md`](crxbox-feedback.md) — the chronological, evidence-tagged
issue/suggestion log referenced throughout (16 entries).

> This is a critical evaluation, not a sales sheet. The verdict is in §1; evidence follows.

---

## 1. Executive summary / verdict

crxbox is a **competent, well-documented ~530-line convenience layer over Playwright** that
encodes genuinely useful Chrome-extension testing knowledge (MV3 service-worker lifecycle,
extension-ID resolution, storage seeding, the "message the SW from a real page" trick). It made
a broad Tabox suite faster to write than a blank Playwright config would have.

It is **not** a new paradigm, a Playwright replacement, or a Storybook competitor. Everything it
does is achievable in raw Playwright; its value is curation and ergonomics, concentrated in ~4
helpers. The abstraction is thin and occasionally leaky, the package is young (`v0.0.0`,
single-maintainer), and it does not address the genuinely hard testability problems of a real
extension (current-window capture, OAuth/cloud sync, migration-on-update).

| Question | Verdict |
|---|---|
| Is it helpful? | **Yes, modestly.** Real time-savings on setup + MV3 arcana. |
| Better than native Playwright? | **Category error** — it *is* Playwright + helpers. Net: convenience, not capability. |
| Better than Storybook? | **Different tool.** e2e of the real extension vs isolated component dev. Complementary. |
| Adopt for a long-lived production suite today? | **Lean no** until ≥1.0; the ~150 useful lines are easy to own yourself. |
| Adopt for a quick start / spike? | **Yes.** |

---

## 2. Methodology & environment

- Installed crxbox into Tabox and authored **45 tests across 22 spec files** covering popup +
  full-page surfaces, service worker, storage, drag-and-drop, downloads, dialogs, settings.
- Full suite: **45 passed in ~1.2 min** (single worker; extensions require a persistent context).
- Drove the framework hard enough to file **16 feedback items**; crxbox was then rebuilt with all
  of them and the suite re-validated (still 45/45).

| Component | Version |
|---|---|
| crxbox | `0.0.0` (local tarball) |
| @playwright/test | `1.60.0` |
| Chromium | rev `1223` |
| Node | `26.0.0` |
| Host project | Tabox — MV3, React 19, Webpack, Yarn 4 (node-modules linker) |

---

## 3. What crxbox actually is (architecture)

The entire framework is **534 lines** of bundled JS (`dist/index.js`). It exports Playwright's
`test`/`expect` extended with two fixtures (`context`, `ext`) plus helper classes:

```
Ext
├── id, url(), openPage(), acceptDialogs(), dragAndDrop(), contentUi()
├── popup     → open(), openForTab()
├── background→ evaluate(), sendMessage(), waitForReady(), kill()
└── storage   → local|sync|session → get/set/clear  (+ toHaveStorageValue matcher)
```

Under the hood it is a wrapper around well-known Playwright primitives:
- `context` fixture = `chromium.launchPersistentContext('', { args: ['--load-extension=…'] })`
- `ext.id` = wait for the `serviceworker` target, parse its URL
- `ext.storage.*` = `serviceWorker.evaluate(() => chrome.storage.*…)`
- `ext.popup.open()` / `openPage()` = read `manifest.action.default_popup`, `newPage()` + `goto()`
- `ext.background.kill()` = CDP `ServiceWorker.stopAllWorkers` over a page-attached session

That last one is the only piece that is genuinely hard to reproduce from memory.

---

## 4. Evidence: what the suite actually leaned on

Hard usage counts across the 22 spec files (occurrences):

| crxbox API | uses | | raw Playwright (fallback) | uses |
|---|---|---|---|---|
| `ext.storage.*` | **97** | | `page.locator` | **68** |
| `ext.background.*` | 12 | | `page.getByRole` | 12 |
| `ext.url()` | 10 | | `expect.poll` | 9 |
| `ext.popup.open()` | 9 | | `page.waitForEvent` | 1 |
| `toHaveStorageValue` | 8 | | `context.pages()` | 1 |
| `ext.dragAndDrop()` | 6 | | `page.mouse` | 0 (was the manual recipe pre-refactor) |
| `ext.id` | 5 | | `page.on('dialog')` | 0 (replaced by `acceptDialogs`) |
| `openForTab` | 4 | | | |
| `ext.contentUi()` | 3 | | | |
| `ext.acceptDialogs()` | 1 | | | |
| `ext.openPage()` | via shared helper | | | |

**Reading of this data:**
- **Storage is the workhorse (97 uses).** Seed `chrome.storage`, open a page, assert the write.
  This single ergonomic carried ~80% of the suite. It is also one of the thinnest wrappers.
- **The suite is mostly vanilla Playwright** (`page.locator` 68, `getByRole` 12, `expect.poll`
  9). crxbox decorates the edges; Playwright does the work.
- **The "exotic" value-add helpers are used 1–4× each** (`kill`, `contentUi`, `acceptDialogs`,
  `openForTab`). They're nice when needed, but they are not where the day-to-day value is.

---

## 5. Strengths (with evidence)

1. **Storage seeding + auto-reset is excellent ergonomics.** Deterministic fixtures via
   `ext.storage.local.set({...})` + read-back assertions made complex flows (backup restore,
   reorder, delete, import) clean. `get(key)` returns the unwrapped value, which reads naturally.
2. **MV3 service-worker lifecycle is handled and correct.** `kill()` + drive-a-real-event →
   the SW restarts and still serves. This is real, arcane value:
   ```
   ✓ background-sw › a force-killed SW restarts on demand and still serves messages (789ms)
   ✓ background-sw › collections written before a restart survive it (882ms)
   ```
3. **`background.sendMessage` from a real extension page** correctly models how an extension's
   own pages talk to its SW — and it's documented *why* (you can't message the SW from itself).
4. **Accurate documentation.** SKILL.md's "async write-through gotcha" and the `openForTab`
   best-effort caveat both proved true in practice (Tabox's delete writes after a 400 ms
   animation; `expect.poll` was required, exactly as warned).
5. **Diagnostic error codes** (`CrxboxError.diagnostic.code`) enable self-correction; e.g.
   `content-ui/not-injected` fired exactly as specified for a never-appearing root.
6. **Responsive design iteration.** Every actionable feedback item shipped in one cycle
   (see §7 + feedback #16), including a new `loader/duplicate-playwright` diagnostic for the
   install footgun.

---

## 6. Weaknesses & issues encountered (with logs)

### 6.1 🔴 Install footgun: duplicate `@playwright/test` (feedback #1)
Consuming crxbox via a live link (yarn `portal:`) to a dev checkout that carries its own
`@playwright/test` loads Playwright twice → hard crash:
```
Error: Requiring @playwright/test second time,
First:  at /…/tabox/node_modules/playwright/lib/index.js:70:33
Second: at /…/crxbox/node_modules/playwright/lib/index.js:65:11
Error: No tests found
```
A first-time user following the README would hit this cryptic Playwright error and bounce. The
later builds added a `loader/duplicate-playwright` diagnostic — good — but the packaging story
(peer dep + dedup) still needs to be the first thing the docs address.

### 6.2 🔴→✅ It swallowed Playwright's own config (feedback #4)
Out of the box the launcher hardcoded options and the fixture forwarded nothing, so `--headed`,
`slowMo`, and `launchOptions` were silently dropped:
```js
// original loader
return chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: ['--disable-extensions-except=…','--load-extension=…'],
}); // no headless, no slowMo, no merge of launchOptions
```
Symptom: `test:e2e` and `test:e2e:headed` behaved identically; no window ever appeared. A wrapper
that blocks the underlying tool's config is the clearest "leaky abstraction" signal. **Fixed**
after feedback (now forwards `headless`/`channel`/`launchOptions`).

### 6.3 🟠 ESM-only with no guidance for CommonJS hosts (feedback #2)
crxbox is `"type": "module"`, export-only `import`. In Tabox (CommonJS), config + specs had to be
`.mjs` or Playwright transpiles toward CJS and `require()` of the ESM-only package fails. Worked
once understood, but undocumented; an `ERR_REQUIRE_ESM`-class failure is an easy first stumble.

### 6.4 🟠 The flagship (`contentUi`) is unprovable on a popup/SW extension (feedback #11)
crxbox's headline feature is content-script UI testing, but Tabox has no content scripts, so it
couldn't be exercised against real injected UI. I validated the helper mechanics by simulating an
injected root (`page.setContent` + a known selector), but crxbox ships **no first-party fixture
extension** to prove its own flagship path. For a framework, that's a notable gap.

### 6.5 🟠 Real testability boundaries crxbox does not (and mostly cannot) solve (feedback #15)
- **"Save the current window's tabs"** — the headline feature of a tab manager — is not testable:
  crxbox opens the popup *as a page* (popup-as-page), so it isn't bound to a real browsing window,
  and the harness's own pages *are* the "current window." `openForTab` is the partial answer but
  is documented best-effort/flaky (in new-headless it took the throw path in my run).
- **Load-time data-repair migration** is gated behind extension-update/version flows that
  storage-seeding + `popup.open()` don't trigger. Evidence — Tabox itself reports:
  ```
  "Automatic migration is now limited to 4.0+ local data. Your older local data was left untouched."
  ```
  So migration logic stays untestable from the consumer side.
- **OAuth / Google Drive sync** — unreachable without network/auth mocking (out of crxbox scope).

These are exactly the *hard* parts of testing this extension, and the framework doesn't help.

### 6.6 🟠 The abstraction is shallow
Every time the task got real — drag-and-drop, multi-tab, dialogs, DOM ordering — I dropped back to
raw Playwright. The pre-refactor drag was hand-rolled `page.mouse` choreography because
`dragTo()` no-ops against dnd-kit's activation distance; downloads used `page.waitForEvent`; tab
opening used `context.pages()`. crxbox later absorbed some of these (`dragAndDrop`,
`acceptDialogs`, `openPage`) — but only after feedback, which underscores how much of "extension
testing" is just Playwright with a few extension-specific seams.

### 6.7 🟠 Maturity / bus factor
`v0.0.0`, single-maintainer. The majority of the now-clean API (`dragAndDrop`, `openPage`,
`acceptDialogs`, `popupViewport`, plus 2 fixed blockers) materialized *during this one session* in
response to feedback. Excellent responsiveness, but betting a long-lived suite on a 0.x release is
a real risk.

---

## 7. Feedback round-trip (what improved during the session)

crxbox absorbed essentially every actionable item and the suite was refactored onto the new API
(all 45 tests still pass — feedback #16):

| Feedback | Shipped as |
|---|---|
| #1 duplicate Playwright | `loader/duplicate-playwright` diagnostic |
| #4 ignored headed/launchOptions | fixture forwards `headless`/`channel`/`launchOptions` |
| #5 popup rendered full-viewport | `popupViewport` option + `popup.open({ viewport })` |
| #7 confirm/alert footgun | `ext.acceptDialogs(page)` |
| #8 dnd-kit `dragTo` no-ops | `ext.dragAndDrop(source, target, opts)` |
| #13 only popup pages openable | `ext.openPage(path, { viewport })` |

This is the strongest *positive* signal about the project: the maintainer treats the gaps as bugs
and closes them fast.

---

## 8. crxbox vs native Playwright vs Storybook

**vs native Playwright** — wrong axis: crxbox *is* Playwright plus fixtures. The real decision is
"adopt a young dependency for ~4 helpers, or copy ~150 lines into your own `fixtures.ts`?" For most
teams, owning the helper file (extension loader, ID resolver, storage wrapper, SW-kill) is just as
good, avoids the dependency, and keeps full control of Playwright config. crxbox wins for speed of
starting and for not having to learn the MV3 CDP arcana yourself.

**vs Storybook** — different category, complementary:

| | Storybook | crxbox / Playwright |
|---|---|---|
| Unit under test | React components in isolation | the real built extension |
| `chrome.*`, SW, manifest | mocked / absent | real |
| Catches | visual/interaction/component regressions | integration bugs (SW handlers, storage indexing, popup↔SW round-trips, migrations) |
| Speed | fast | slower (real Chromium, persistent context) |

For an extension, the bugs that actually ship and break users live in the service worker and
storage layers — which Storybook can't see and e2e can. If forced to keep one for an extension,
keep e2e. (Tabox already has jsdom/RTL component tests covering the Storybook-ish niche.)

---

## 9. How crxbox could improve (prioritized)

**P0 — make adoption foolproof**
1. **Own the packaging story.** Lead the README with the peer-dep/dedup requirement; keep the new
   `loader/duplicate-playwright` diagnostic; provide a one-line "consume me" recipe for npm/yarn/pnpm.
2. **Ship a first-party fixture extension** (popup + content script + options + SW) and run crxbox's
   own e2e tests against it. This proves `contentUi` (the flagship), `openForTab`, shadow/iframe
   options, and gives adopters a copyable reference. Right now the flagship is unproven by the repo.
3. **Document the ESM/CommonJS story** with a `.mjs` config+spec example.

**P1 — close the real-extension testing gaps**
4. **A real "current window with known tabs" primitive.** The single biggest miss: a way to open a
   normal window, seed it with specific tabs, and run popup logic against *that* window — so
   "save current tabs," "open collection into a window," and active-tab flows become testable.
   This is the feature that would make crxbox meaningfully better than rolling your own.
5. **A migration/update simulation hook** — e.g. `ext.simulateUpdate({ previousVersion })` that sets
   the flags an extension's `runtime.onInstalled`/update path checks, so update-gated logic (data
   repair, migrations) is reachable.
6. **Harden `openForTab`** or clearly mark it experimental; in new-headless it's effectively the
   throw path, so today it documents a contract more than it tests behavior.

**P2 — polish**
7. **Stabilize a version** (≥1.0), publish to a registry, add a changelog. The 0.0.0 + single-maintainer
   posture is the main blocker to production adoption.
8. **More matchers** in the storage spirit — e.g. `toHaveCollectionCount`-style helpers are app-specific,
   but generic ones like `toHaveStorageKeys`, or a polling variant of `toHaveStorageValue` (the
   single-read caveat bit me; a `toEventuallyHaveStorageValue` would remove the `expect.poll` dance).
9. **Trace/debug ergonomics** — a documented `PWDEBUG`/trace recipe that works through the fixtures.

---

## 10. Risk assessment for adopters

| Risk | Severity | Note |
|---|---|---|
| `v0.0.0`, single maintainer | High | API churned within one session; no SemVer guarantees yet |
| Thin value over DIY | Medium | ~150 of its ~530 lines are the part you'd actually want |
| Chrome/Playwright drift | Medium | SW-kill CDP technique + headless behavior are version-sensitive |
| Flagship unproven in-repo | Medium | `contentUi` shipped without a fixture extension exercising it |
| Lock-in | Low | Thin wrapper; ejecting back to raw Playwright is straightforward |

---

## 11. Bottom line

crxbox is a **genuinely useful, well-documented starter kit** that lowered the cost of building a
real MV3 e2e suite and encodes some arcane knowledge worth having (SW restart, storage seeding,
the SW-message trick). It is **modestly helpful, not transformative**, and it is **not** a
substitute for knowing Playwright — ~90% of the suite is vanilla Playwright with crxbox decorating
the seams.

- **Use it** for a fast start, a spike, or a team that wants the MV3 knowledge baked in and trusts
  the maintainer to track Chrome/Playwright changes.
- **Roll your own thin fixture** (or vendor crxbox's helpers) for a long-lived production suite
  today — and reconsider crxbox once it's ≥1.0 with a fixture extension and a current-window
  primitive.

The single change that would most raise its ceiling: **solve the real-window / current-tabs
problem (§9 P1.4)** — that's the one thing it can offer that a hand-written fixture file can't
trivially replicate, and it's exactly the gap that blocked the highest-value Tabox tests.

---

## Appendix A — test inventory (45 tests, 22 specs)
Popup: settings-menu, restore-backup, recovery-panel-restore, reorder-collections, delete-collection,
export-download, storage-sync, background-sw. Full-page (`fp-*`): layout, folder-nav, reorder,
settings, settings-more, card-actions, create-folder, folders, detail-bulk. crxbox gap-closure
(`cx-*`): storage-session, content-ui, identity. Lifecycle: tab-lifecycle, collection-ops.

## Appendix B — environment caveats
Tests ran offline against the internal registry; opened tabs use extension-page URLs to load
without network. Service-worker coverage is exercised behaviorally (message round-trips, restart),
not via instrumented line coverage. Estimated functional coverage: crxbox API ~95%, Tabox user
flows ~65–70% (no measured line coverage — see the coverage discussion in session history).

## Appendix C — companion log
[`crxbox-feedback.md`](crxbox-feedback.md) — 16 evidence-tagged entries (🔴 blocker · 🟠 friction ·
🟢 positive · 💡 suggestion) accumulated chronologically while building the suite.

---

## 12. Follow-up: crxbox `0.1.0` (re-evaluation)

After this report, crxbox shipped **`0.1.0`** — the first version bump off `0.0.0` — and it
directly implements the two highest-leverage recommendations from §9 P1. I reinstalled it
(regression: **all prior tests still pass**) and wrote probe tests
(`e2e/cx-windows-update.spec.mjs`). Suite is now **47 tests / 23 specs**.

### What shipped (vs §9 recommendations)
| §9 item | Shipped in 0.1.0 |
|---|---|
| P1.4 — "current window with known tabs" primitive | **`ext.windows.create({ tabs, focused })`** → real `WindowHandle { id, tabs: Page[], focus(), close() }`, plus **`ext.tabs.create/query/close`** |
| P1.5 — migration/update simulation hook | **`ext.simulateUpdate({ reason, previousVersion })`** (fires `chrome.runtime.onInstalled`) |
| P1.6 — harden `openForTab` | `openForTab` doc now points at `ext.windows.create({ focused: true })` for the focused-window requirement |
| New diagnostics | `window/create-failed`, `tabs/not-found`, `simulate-update/unavailable` |

### Boundary §6.5 #2 (update-gated migration) — ✅ DISSOLVED
The migration test I had to **drop** earlier now passes via `simulateUpdate`. Evidence:
```
✓ cx-windows-update › ext.simulateUpdate unlocks update-gated migration (deferred-URL repair) (963ms)
```
`ext.simulateUpdate({ reason: 'update', previousVersion: '4.0.0' })` fired Tabox's SW
`onInstalled` listener → it set `extensionUpdated: true` → opening the popup ran the
update-gated data-repair migration → the seeded `deferedLoading.html?url=…` tab URL was
rewritten to the real destination. This is exactly the path that was unreachable in §6.5.
*Caveat:* `simulateUpdate` is `@experimental` and relies on a version-sensitive Chromium
internal (`onInstalled.dispatch`); it worked on Chromium 1223 / Playwright 1.60 here, but the
author themselves recommends seeding state + driving the entry point directly for robustness.

### Boundary §6.5 #1 (current window with known tabs) — ◑ FOUNDATION shipped, full UI flow still gated
The primitive works and is verified:
```
✓ cx-windows-update › ext.windows.create seeds a real window with known tabs; ext.tabs.query sees them (885ms)
```
This is genuinely valuable — e.g. it makes "open this collection → assert its tabs landed in a
real window" cleanly assertable. **However**, the headline *"save the current window's tabs via
the popup UI"* flow is still **not** cleanly testable, and that's not crxbox's fault: Tabox's
`getCurrentTabsAndGroups()` resolves tabs via `{ currentWindow: true }` / `WINDOW_ID_CURRENT`,
which is the **popup page's own window**. Binding the popup to a *different* (seeded) window
still requires `ext.popup.openForTab()`, which remains best-effort and takes the
`popup/no-active-tab` throw path in new-headless. So: the foundation now exists, but the
end-to-end save-from-current-window flow depends on `openForTab` maturity (or running headed).

### Revised verdict
The §1 verdict mostly stands — crxbox is still a Playwright convenience layer, not a new
capability — but two things have **materially changed for the better**:
1. **The "thin value / just DIY" argument is weaker now.** `windows`/`tabs`/`simulateUpdate`
   are non-trivial, extension-specific primitives most teams would *not* build themselves.
   crxbox is accumulating real capability you'd actually want to depend on, not just setup sugar.
2. **The maintainer demonstrably ships the hardest feedback within a release cycle.** Every P0
   and the top P1 items landed across two iterations, with new diagnostics. That trajectory
   meaningfully de-risks the "young project" concern (though `0.x` + single-maintainer still
   warrants caution for long-lived suites).

If 0.1.0's pace continues — and `openForTab` gets hardened so the save-from-current-window flow
closes — my recommendation would shift from "lean DIY today" toward "reasonable to adopt." The
gap between "useful convenience" and "genuinely worth the dependency" is closing.

---

## 13. Follow-up: crxbox `0.2.0` — the last hard boundary is gone

`0.2.0` shipped **`ext.popup.openInWindow(window, popupPath?)`** — open the popup *as a tab inside
a chosen window*, so the popup's `chrome.tabs.query({ currentWindow: true })` /
`windows.getCurrent()` resolve to **that** window. This is a smarter answer than hardening the
flaky real-action-popup (`openForTab`): instead of fighting `chrome.action.openPopup`, it sidesteps
it. Regression: all prior tests still pass (suite now **48 tests / 23 specs**).

### Boundary §6.5 #1 (save the current window's tabs) — ✅ DISSOLVED
The flow I repeatedly called **untestable** now has a passing test:
```
✓ cx-windows-update › save-current-tabs: openInWindow lets the popup capture a seeded window's tabs (1.2s)
```
`ext.windows.create({ tabs:[…] })` → `ext.popup.openInWindow(win)` → type a name → click
**Add Collection** → Tabox's `getCurrentTabsAndGroups({ currentWindow: true })` resolves to the
seeded window → a collection is saved containing the seeded tab. Verified end-to-end (storage
shows the new collection with the seeded URL; the in-app toast confirms "created successfully").

This was the single change I said in §11 "would most raise its ceiling … the one thing it can
offer that a hand-written fixture file can't trivially replicate." It now exists and works.

### Minor new finding
`ext.windows.create({ tabs })` **hangs on `data:` URLs** — its tab capture waits for a `page`
event that a `data:` navigation doesn't emit a matching target for (10s timeout). Works fine with
http(s)/extension URLs. Worth either supporting `data:`/`about:blank` seeds or documenting the
constraint. (Logged in the feedback companion.)

### Net trajectory — verdict revised upward
Across three releases (`0.0.0`→`0.2.0`), crxbox closed **every** P0 and **both** P1 boundaries I
identified, including the one I explicitly flagged as the highest-value, hardest-to-DIY gap. The
"thin wrapper / just roll your own" argument no longer really holds: `windows`/`tabs`/
`simulateUpdate`/`openInWindow` are non-trivial, correct, extension-specific primitives that
encode real Chrome-testing insight a typical team would *not* reinvent well.

Updated stance:
- **Maturity risk remains** (`0.x`, single-maintainer, `simulateUpdate` is `@experimental`,
  the `data:`-seed gap) — so for a long-lived production suite I'd still want a pinned version
  and an eye on the changelog.
- **But the capability and responsiveness now justify adoption** for most extension teams who'd
  otherwise spend real time reinventing this. My recommendation moves from *"lean DIY today"* to
  **"reasonable to adopt, pin the version."** The earlier "modestly helpful, not transformative"
  framing was fair for `0.0.0`; at `0.2.0` it is closer to *genuinely useful* — it now tests
  things I had documented as out of reach.

---

## 14. Follow-up: crxbox `0.2.1` — last open bug fixed; project nearing maturity

`0.2.1` is a **patch with no API surface change** (verified: `dist/index.d.ts` is byte-identical
to `0.2.0`). It fixes the one open bug from §13:

### `windows.create({ tabs })` data:-URL hang — ✅ FIXED
Spike (throwaway) confirmed the previously-hanging case now resolves:
```
✓ spike: windows.create with data: URLs no longer hangs (1.6s)  → win.tabs.length === 2
```
The `save-current-tabs` test was simplified back to clean `data:` URLs (it had been working
around the bug with extension URLs); it now doubles as a regression guard. Full suite: **48/48**.

### Triage of what remains (nothing capability-blocking)
| Open item | Bucket | Note |
|---|---|---|
| ESM/CommonJS host docs (§6.3) | docs | unverifiable from the consumer side |
| First-party `contentUi` fixture extension (§9 P0.2) | repo-side | can't verify from tabox; still recommended |
| Polling matcher `toEventuallyHaveStorageValue` (§9 P2) | P2 polish | would remove the `expect.poll` dance |
| CHANGELOG + path to 1.0 (§9 P2) | maturity | no CHANGELOG shipped in the tarball |
| `openForTab` hardening (§9 P1.6) | superseded | `openInWindow` is the better answer; demote to docs |
| `simulateUpdate` `@experimental` | inherent | version-sensitive internal; keep the flag |
| OAuth / Drive sync | out-of-scope | document the boundary |

### Verdict (unchanged direction, firmer)
Across `0.0.0`→`0.2.1`, crxbox closed every blocker, both testability boundaries, **and** the
one follow-up bug — each within a release. There is no longer a capability gap I can point to
for this extension; what's left is polish, docs, and the formal march to `1.0`. Recommendation
stays **"reasonable to adopt, pin the version,"** now with higher confidence: the patch-level
responsiveness is itself evidence the project is maturing past the "young, churny `0.x`" risk
that dominated the original §1 verdict.
