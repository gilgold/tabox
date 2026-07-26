// Tabox Pro configuration. Loaded via importScripts in background.js.
// PRO_ENV switches the entitlement worker between environments:
//   'production' — live Paddle catalog (real payments)
//   'sandbox'    — Paddle sandbox catalog (test cards, E2E runs)
// Release builds MUST ship with PRO_ENV = 'production'.
const PRO_ENV = 'sandbox'; // TESTING — revert to 'production' before release

const PRO_API_BASES = {
  production: 'https://tabox-api.gilgold13.workers.dev',
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

if (typeof module !== 'undefined') {
  module.exports = { PRO_ENV, PRO_API_BASE, PRO_CHECKOUT_URL, PUSH_VAPID_PUBLIC_KEY };
}
