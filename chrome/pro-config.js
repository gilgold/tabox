// Tabox Pro configuration. Loaded via importScripts in background.js.
// PRO_ENV switches the entitlement worker between environments:
//   'production' — live Paddle catalog (real payments)
//   'sandbox'    — Paddle sandbox catalog (test cards, E2E runs)
// Release builds MUST ship with PRO_ENV = 'production'.
// NOTE: Worker API calls need NO host_permissions entry (in either env) — the
// Worker answers CORS preflights and sends `Access-Control-Allow-Origin: *` on
// every JSON route (see server/src/index.js), and our calls use bearer tokens,
// not cookies. Do NOT re-add the worker URL to host_permissions: a new host
// permission hard-disables the extension on auto-update until users re-approve.
// Switching to 'sandbox' still requires adding the sandbox worker URL
// (https://tabox-api-sandbox.gilgold13.workers.dev) to externally_connectable
// in chrome/manifest.json for the join-link handshake — release manifests ship
// the production entry only.
const PRO_ENV = 'production';

const PRO_API_BASES = {
  production: 'https://share.tbxpro.app',
  sandbox: 'https://tabox-api-sandbox.gilgold13.workers.dev',
};

const PRO_API_BASE = PRO_API_BASES[PRO_ENV];

// Sandbox checkout runs on a locally-served copy of the checkout page with
// PADDLE_ENV='sandbox' (serve it via the "sandbox-checkout" launch config,
// port 8787) so live tabox.co/pro is never involved in test purchases.
const PRO_CHECKOUT_URLS = {
  production: 'https://tabox.co/pro',
  sandbox: 'http://localhost:8787/sandbox-checkout.html',
};
const PRO_CHECKOUT_URL = PRO_CHECKOUT_URLS[PRO_ENV];

// VAPID public key for the Web Push subscription (chrome/push-client.js).
// The matching private key lives only on the Tabox Worker as a secret.
const PUSH_VAPID_PUBLIC_KEYS = {
  production: 'BApsYowPf5VhtXCdG_vnb6-GDt_HACafMtAsCsgPoubW_a8OX5wc8o6Jp9fyJzWeLCL3OQ399TCRXry1R8hXkqA',
  sandbox: 'BFKhknaosNAOD_YlEG-3eaGw2s3tYAfwh0hPbk1ZQOU1w4Loe8G1FKyir66KfaNuLnjPT7syrwvR5wB62X9OoO8',
};
const PUSH_VAPID_PUBLIC_KEY = PUSH_VAPID_PUBLIC_KEYS[PRO_ENV];

// Google OAuth client config. Chrome kept these in manifest.json's oauth2 key,
// but Firefox doesn't support that key at all — so the code reads them from
// here in both browsers. Must stay in sync with the oauth2 block in
// chrome/manifest.json (tests/oauthConfig.test.js enforces parity).
const OAUTH_CLIENT_ID = '701423091804-t6v1r6mkl4jdptge49gb7sfstj4holfr.apps.googleusercontent.com';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
];

if (typeof module !== 'undefined') {
  module.exports = { PRO_ENV, PRO_API_BASE, PRO_CHECKOUT_URL, PUSH_VAPID_PUBLIC_KEY, OAUTH_CLIENT_ID, OAUTH_SCOPES };
}
