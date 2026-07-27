---
name: verifying-store-release
description: Use before any Tabox store release — before merging a release branch to main, when asked "are we good to ship / good to go / release-ready", or before publishing to the Chrome Web Store or Edge Add-ons.
---

# Verifying Store Release

## Overview

Merging to `main` IS publishing: `.github/workflows/release.yml` builds and pushes to both stores on every push to main. This checklist is the last gate before that. Run every section; report a verdict only after all commands have actually run.

**Verify against a `yarn build:release` artifact, not `yarn prod`.** `yarn prod` / `yarn build` keep sourcemaps and `console.log` — scanning that build gives false failures, and skipping the scan because "CI builds its own" gives false passes.

## Checklist

Create a todo per section. All output must be from commands you ran this session.

### 1. Production, not sandbox

The environment switch is a hardcoded constant copied verbatim into the bundle — no webpack define, no env var:

```bash
grep -n "PRO_ENV = " chrome/pro-config.js                                   # must be 'production'
grep -n "PADDLE_ENVIRONMENT\|PADDLE_CLIENT_TOKEN =" site/pricing/velo-pro-page.js  # 'production' + live_ token
grep -n "FORCE_ONBOARDING_FOR_POPUP_TESTING" app/OnboardingGuide.js         # must be false
```

`server/checkout-page/tabox-pro-checkout.html` is a sandbox-only E2E harness, never served in production (the real checkout is built from `site/pricing/pricing.template.html`) — its `PADDLE_ENV = 'sandbox'` is correct; do not flag it.

Then network surfaces and placeholders:

```bash
grep -n "sandbox\|localhost" chrome/manifest.json          # must be empty (host_permissions/externally_connectable are prod-only)
grep -rn "REPLACE_WITH" server/checkout-page/ site/pricing/ # must be empty — placeholder tokens block release
grep -n "PADDLE_API_BASE\|PRICE_" server/wrangler.toml | grep -v sandbox   # top-level env: api.paddle.com + live pri_ ids
```

After building (section 4), also confirm the artifact (the bundle legitimately contains sandbox URLs inside the env lookup maps — check the selector, not the map):

```bash
grep -o 'PRO_ENV="[a-z]*"' build/pro-config.js                    # must be PRO_ENV="production"
grep -n "tabox-api-sandbox\|localhost" build/manifest.json || echo CLEAN  # must be CLEAN
```

Known false-positive traps: production hostnames legitimately contain `gilgold13`; `darkstorm13` appears only as a test fixture in `tests/SettingsMenu.googleId.test.js`; exclude `.claude/worktrees/` from any repo-wide grep.

### 2. Git identity — gilgold, never gil-wix

Config alone is not enough; check the actual unpushed/unmerged commits:

```bash
git config user.name && git config user.email   # Gil Goldstein / darkstorm13@gmail.com
gh auth status                                   # active account: gilgold
git log origin/main..HEAD --format='%an <%ae>%n%cn <%ce>' | sort -u
```

The log must show only `darkstorm13@gmail.com`. Scope is `origin/main..HEAD` — historical `gilgo@wix.com` commits already merged into main are known and accepted; do not flag them, and do not widen the check to `--all`.

### 3. No Wix npm registry URLs

```bash
grep -rniE 'wixpress|repo\.dev\.wix|npm\.dev\.wix|artifactory' \
  yarn.lock server/yarn.lock .yarnrc.yml server/.yarnrc.yml .npmrc server/.npmrc 2>/dev/null
```

Must be empty. Both `.yarnrc.yml` files must point at a public registry (`registry.npmjs.org` or `registry.yarnpkg.com` — either is fine).

### 4. No secrets in the bundle

CI's only check is `build/api-keys.json` existence — it scans no content. Do the real scan locally:

```bash
yarn build:release
test ! -f build/api-keys.json && echo OK
grep -rniE 'sk-or-|GOCSPX-|pdl_(live|sdbx)_|clientSecret|BEGIN [A-Z ]*PRIVATE KEY|PADDLE_WEBHOOK_SECRET|JWT_SECRET|VAPID_PRIVATE' build/ || echo CLEAN
find build -name '*.map' ! -name 'browser-polyfill.min.js.map'   # must be empty
grep -rlE '^//# sourceMappingURL' build --include='*.js' | grep -v browser-polyfill || echo CLEAN
grep -c 'console\.log' build/background.js                        # must print 0 (release build strips these)
```

Note: style-loader's runtime contains the string `sourceMappingURL=data:` inside a literal — that is not a map directive; only a `//# sourceMappingURL` line at line start counts.

```bash
```

The string "OpenRouter" in bundles is UI copy, not a key. `sk-or-secret` in `server/test/aiProxy.test.js` is a fixture — `server/` is not bundled. Local `chrome/api-keys*.json` and `.env*` files are gitignored and not copied (CopyPlugin glob is `chrome/*.js`); if anyone widens that glob to `chrome/*`, the Google client secret ships — check the glob if `webpack.js` changed.

### 5. Release mechanics

```bash
yarn lint && yarn test
git status --short                               # working tree must be clean
grep '"version"' chrome/manifest.json package.json  # must match each other
curl -sS 'https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=140&x=id%3Dbdbliblipiempfdkkkjohnecmeknnpoa%26uc' \
  | sed -n 's/.*updatecheck[^>]*version="\([0-9.]*\)".*/\1/p'   # prints the live CWS version (same command CI uses)
# live version must DIFFER from the manifest version — CI silently skips publishing when they're equal
```

- Version comes solely from `chrome/manifest.json`; nothing syncs it with `package.json`. CI *skips publishing* if the live CWS version equals the manifest version — an unbumped version means a silent no-op release.
- If `server/**` changed since the last release, the Worker deploys via a separate workflow on the same merge; ordering vs the extension publish is not enforced. Confirm the Worker change is backward-compatible with the currently-published extension.
- `manifest.key` must be present (Chrome) — CI strips it for Edge itself.

## Verdict rules

- Report **BLOCKED** with the exact failing command output if any check fails. Never "mostly good".
- A check you skipped is a check that failed — say "not verified", not "should be fine".
- "CI will catch it" is false for everything except lint/tests/api-keys.json existence.

| Rationalization | Reality |
|---|---|
| "The code was already switched to production in a previous commit" | Constants get flipped back during testing. Grep now. |
| "git config shows the right account, commits are fine" | Config is current-state; commits are history. Check the log. |
| "yarn prod build is basically the same" | It ships sourcemaps and console.logs. Only `build:release` matters. |
| "30 minutes isn't enough for all of this" | Sections 1–3 are pure greps (< 2 min). Only the build takes time. |
