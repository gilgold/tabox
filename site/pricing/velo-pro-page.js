// Velo page code for the Tabox "/pro" pricing page.
//
// SETUP (one-time, in the Wix Editor with Dev Mode ON):
//   1. Enable Dev Mode (Velo) on the site.
//   2. Package Manager (Packages & Apps -> npm): install  @paddle/paddle-js
//   3. On the /pro page, add these elements and set their IDs exactly:
//        - Text    #priceText        (shows e.g. "$5.99 / month")
//        - Button  #monthlyButton     (label "Monthly")
//        - Button  #yearlyButton      (label "Yearly")
//        - Button  #subscribeButton   (label "Subscribe")
//        - Text    #errorText         (optional; leave blank, used for error messages)
//   4. Paste this into the /pro page's code panel. Publish.
//
// NOTE: This runs in the top frame (tabox.co origin), so Paddle's approved-domain
// check and the success redirect work correctly. Live checkout still requires your
// Paddle account to be verified and www.tabox.co approved (the "Test and go live" step).

import { initializePaddle } from '@paddle/paddle-js';
import { currentMember } from 'wix-members-frontend';
import wixLocation from 'wix-location';

// ---- Config (edit here) ---------------------------------------------------
const PADDLE_ENVIRONMENT = 'production'; // 'production' | 'sandbox'
const PADDLE_CLIENT_TOKEN = 'live_b18d742329ee33650b3d89f8d5d'; // public client-side token
const SITE_URL = 'https://www.tabox.co'; // canonical origin for the success redirect
const PRICE_IDS = {
  month: 'pri_01kxk6xwxdgmtr2eat3xqacs3z',
  year: 'pri_01kxk6xx37e1h9pdjvmvy457br',
};
// ---------------------------------------------------------------------------

let paddle;
let cadence = 'month';
const formatted = {}; // priceId -> Paddle's already-formatted total string (displayed verbatim)

$w.onReady(async () => {
  paddle = await initializePaddle({
    environment: PADDLE_ENVIRONMENT,
    token: PADDLE_CLIENT_TOKEN,
  });

  // Localized prices. No country code is passed — Paddle auto-detects from the visitor's IP.
  try {
    const preview = await paddle.PricePreview({
      items: [
        { priceId: PRICE_IDS.month, quantity: 1 },
        { priceId: PRICE_IDS.year, quantity: 1 },
      ],
    });
    preview.data.details.lineItems.forEach((li) => {
      // Display ONLY Paddle's formatted string — no math, no reformatting.
      formatted[li.price.id] = li.formattedTotals.total;
    });
    render();
  } catch (e) {
    setError('Could not load prices. Please try again later.');
    console.error('PricePreview failed', e);
  }

  $w('#monthlyButton').onClick(() => setCadence('month'));
  $w('#yearlyButton').onClick(() => setCadence('year'));
  $w('#subscribeButton').onClick(() => openCheckout());
});

function setCadence(c) {
  cadence = c;
  render();
}

function render() {
  const total = formatted[PRICE_IDS[cadence]];
  const suffix = cadence === 'month' ? ' / month' : ' / year';
  $w('#priceText').text = total ? total + suffix : 'Unavailable';
  $w('#subscribeButton').enable && (total ? $w('#subscribeButton').enable() : $w('#subscribeButton').disable());
}

function setError(msg) {
  try { $w('#errorText').text = msg; } catch (_) { /* #errorText is optional */ }
}

async function openCheckout() {
  // The extension opens /pro?uid=<googleId>&email=<address> — the Worker's
  // Paddle webhook keys the entitlement on customData.googleId. Without it the
  // subscription parks as subpending:* in KV and the buyer never gets Pro, so
  // never open a checkout we can't link.
  const { uid, email: queryEmail } = wixLocation.query;
  if (!uid) {
    setError('To upgrade, please start the checkout from the Tabox extension (Settings → Upgrade to Pro) so we can link Pro to your account.');
    return;
  }

  let email;
  try {
    const member = await currentMember.getMember();
    email = member && member.loginEmail; // prefill if signed in
  } catch (_) { /* not logged in — fall back to the extension-provided email */ }
  if (!email) email = queryEmail;

  paddle.Checkout.open({
    items: [{ priceId: PRICE_IDS[cadence], quantity: 1 }],
    customer: email ? { email } : undefined,
    customData: { googleId: uid },
    settings: {
      displayMode: 'overlay',
      variant: 'one-page',
      successUrl: SITE_URL + '/welcome',
    },
  });
}
