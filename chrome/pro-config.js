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

if (typeof module !== 'undefined') {
  module.exports = { PRO_ENV, PRO_API_BASE, PRO_CHECKOUT_URL };
}
