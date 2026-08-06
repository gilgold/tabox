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
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { TIERS } from './tiers.js';

const here = dirname(fileURLToPath(import.meta.url));
const WIX_CUSTOM_CODE_LIMIT = 15000;

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

const expandedHtml = template
  .replace('__PADDLE_ENVIRONMENT__', env)
  .replace('__PADDLE_CLIENT_TOKEN__', token)
  .replace('__SITE_URL__', siteUrl)
  .replace('__TIERS_JSON__', JSON.stringify(TIERS));

if (expandedHtml.includes('__PADDLE_') || expandedHtml.includes('__TIERS_JSON__')) {
  fail('Template still contains unreplaced placeholders — aborting.');
}

// Wix limits each Custom Code snippet to 15,000 characters. The readable source
// stays in pricing.template.html; the generated snippet inflates it in-browser,
// inserts the markup/styles, then recreates its scripts in their original order.
const payload = gzipSync(Buffer.from(expandedHtml), { level: 9 }).toString('base64');
const html = '<!-- Tabox pricing: generated; edit pricing.template.html, not this file. -->' +
  '<script>(async()=>{const t=document.createElement("template"),' +
  `b=Uint8Array.from(atob("${payload}"),c=>c.charCodeAt(0)),` +
  'h=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
  't.innerHTML=h;const s=[...t.content.querySelectorAll("script")];s.forEach(e=>e.remove());' +
  'document.body.append(t.content);for(const e of s){const n=document.createElement("script");' +
  'for(const x of e.attributes)n.setAttribute(x.name,x.value);if(e.src)' +
  'await new Promise(r=>{n.onload=r;n.onerror=r;document.body.append(n)});' +
  'else{n.textContent=e.textContent;document.body.append(n)}}})().catch(console.error)</script>';

if ([...html].length > WIX_CUSTOM_CODE_LIMIT) {
  fail(`Generated snippet is ${[...html].length} characters; Wix allows ${WIX_CUSTOM_CODE_LIMIT}.`);
}

// Tests write to a disposable path so a sandbox fixture can never replace the
// production artifact intended for the Wix Custom Code block.
const outPath = process.env.PRICING_OUTPUT_PATH
  ? resolve(process.env.PRICING_OUTPUT_PATH)
  : join(here, 'pricing.html');
await writeFile(outPath, html, 'utf8');
console.log(
  `✓ built ${outPath}  (env=${env}, token=${token.slice(0, 5)}…, ` +
  `tiers=${TIERS.length}, wixChars=${[...html].length}/${WIX_CUSTOM_CODE_LIMIT})`,
);
