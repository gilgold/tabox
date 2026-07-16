// Builds the static Tabox pricing page from pricing.template.html + tiers.js,
// injecting the Paddle environment + client token from env vars.
//
// Usage:
//   PADDLE_ENV=production PADDLE_CLIENT_TOKEN=live_xxx node site/pricing/build-pricing.mjs
//
// Fails loudly (non-zero exit) if env is unset/invalid, or if the token prefix
// does not match the environment — so we never ship against the wrong account.
//
// Output: site/pricing/pricing.html (the file embedded into the Wix page).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS } from './tiers.js';

const here = dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error(`\n✗ build-pricing: ${msg}\n`);
  process.exit(1);
}

const env = process.env.PADDLE_ENV;
if (!env) fail('PADDLE_ENV is not set. Set it to "production" or "sandbox".');
if (env !== 'production' && env !== 'sandbox') {
  fail(`PADDLE_ENV must be "production" or "sandbox" (got "${env}").`);
}

const token = process.env.PADDLE_CLIENT_TOKEN;
if (!token) fail('PADDLE_CLIENT_TOKEN is not set. Use the client-side token (public), not the API key.');

// Guard against shipping the wrong token in the wrong environment.
const expectedPrefix = env === 'production' ? 'live_' : 'test_';
if (!token.startsWith(expectedPrefix)) {
  fail(`PADDLE_CLIENT_TOKEN should start with "${expectedPrefix}" for PADDLE_ENV=${env} (got "${token.slice(0, 5)}…").`);
}
// A live secret API key starts with "apikey_"/"pdl_"; never allow one here (would leak server creds).
if (token.startsWith('apikey_') || token.startsWith('pdl_') || token.startsWith('sk_')) {
  fail('PADDLE_CLIENT_TOKEN looks like a server API key. Use the client-side token only.');
}

// Canonical site origin for the checkout success redirect. Defaults to the live site.
// Must be https and origin-only (no trailing path) — used as `${SITE_URL}/welcome`.
const siteUrl = (process.env.SITE_URL || 'https://www.tabox.co').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(siteUrl)) {
  fail(`SITE_URL must be an https origin with no path (got "${siteUrl}").`);
}

const template = await readFile(join(here, 'pricing.template.html'), 'utf8');

const html = template
  .replace('__PADDLE_ENVIRONMENT__', env)
  .replace('__PADDLE_CLIENT_TOKEN__', token)
  .replace('__SITE_URL__', siteUrl)
  .replace('__TIERS_JSON__', JSON.stringify(TIERS));

if (html.includes('__PADDLE_') || html.includes('__TIERS_JSON__')) {
  fail('Template still contains unreplaced placeholders — aborting.');
}

const outPath = join(here, 'pricing.html');
await writeFile(outPath, html, 'utf8');
console.log(`✓ built ${outPath}  (env=${env}, token=${token.slice(0, 5)}…, tiers=${TIERS.length})`);
