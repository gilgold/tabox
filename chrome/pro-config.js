// Tabox Pro configuration. Loaded via importScripts in background.js.
// PRO_ENV switches the entitlement worker between environments:
//   'production' — live Paddle catalog (real payments)
//   'sandbox'    — Paddle sandbox catalog (test cards, E2E runs)
// Release builds MUST ship with PRO_ENV = 'production'.
const PRO_ENV = 'production';

const PRO_API_BASES = {
  production: 'https://tabox-api.gilgold13.workers.dev',
  sandbox: 'https://tabox-api-sandbox.gilgold13.workers.dev',
};

const PRO_API_BASE = PRO_API_BASES[PRO_ENV];
const PRO_CHECKOUT_URL = 'https://tabox.co/pro';

if (typeof module !== 'undefined') {
  module.exports = { PRO_ENV, PRO_API_BASE, PRO_CHECKOUT_URL };
}
