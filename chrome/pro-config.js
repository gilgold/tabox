// Tabox Pro configuration. Loaded via importScripts in background.js.
// PRO_API_BASE: fill the real workers.dev URL after Task 6's first deploy.
const PRO_API_BASE = 'https://tabox-api.REPLACE-SUBDOMAIN.workers.dev';
const PRO_CHECKOUT_URL = 'https://tabox.co/pro';

if (typeof module !== 'undefined') {
  module.exports = { PRO_API_BASE, PRO_CHECKOUT_URL };
}
