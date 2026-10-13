// GET /auth/start — the Firefox OAuth entry point.
//
// Firefox's identity.launchWebAuthFlow validates the `redirect_uri` query
// param of whatever URL it is given against the extension's own
// identity.getRedirectURL() (or the 127.0.0.1/mozoauth2 loopback) and rejects
// anything else with "redirect_uri not allowed" — BEFORE opening any window
// (toolkit/components/extensions/child/ext-identity.js). Google, on the other
// hand, only accepts pre-registered redirect URIs, and the per-profile
// *.extensions.allizom.org URL can't be registered. This route bridges the
// two: the extension hands launchWebAuthFlow a /auth/start URL whose
// `redirect_uri` is its own allizom URL (satisfying Firefox's validator), and
// this handler 302s to Google's auth endpoint with the Worker's registered
// /auth/callback as the real redirect_uri. /auth/callback later 302s back to
// the allizom target carried in `state`, which launchWebAuthFlow intercepts.
//
// Like /auth/callback, this endpoint is UNAUTHENTICATED and internet-facing.
// It only ever redirects to Google's fixed auth endpoint with a
// server-controlled client_id/scope set, so it cannot be used as an open
// redirect or to request arbitrary scopes; `state` is validated to carry an
// allowlisted allizom target and passed through verbatim otherwise.

import { badRequest, parseState, isValidTarget } from './authCallback.js';

// GET /auth/done — landing page for the tab-based flow (Firefox for Android).
// The extension reads the code from the fragment via tabs.onUpdated and closes
// the tab; this body only shows if that somehow doesn't happen.
export function handleAuthDone() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Tabox sign-in</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px">'
      + '<h1 style="font-size:20px">Signed in to Tabox</h1><p>You can close this tab.</p></body>',
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    },
  );
}

// Must stay in sync with OAUTH_SCOPES in chrome/pro-config.js (plus the
// leading `openid`, which the extension prepends in createAuthEndpoint).
const OAUTH_SCOPE = 'openid https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';

export function handleAuthStart(request, env) {
  const url = new URL(request.url);
  const rawState = url.searchParams.get('state');

  const state = parseState(rawState);
  if (!state) return badRequest();
  if (!isValidTarget(state.t, url.origin)) return badRequest();

  // The redirect_uri param exists only to satisfy Firefox's client-side
  // validator; it must be the same allizom target the state carries, so a
  // mismatch means a hand-crafted URL — reject it.
  const redirectUri = url.searchParams.get('redirect_uri');
  if (redirectUri !== null && redirectUri !== state.t) return badRequest();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: `${url.origin}/auth/callback`,
    prompt: 'consent',
    scope: OAUTH_SCOPE,
    state: rawState,
  }).toString();

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), 'Cache-Control': 'no-store' },
  });
}
