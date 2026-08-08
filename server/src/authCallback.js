// GET /auth/callback — the fixed, Google-registered redirect used for the
// Firefox OAuth flow (see docs/superpowers/plans/2026-08-06-firefox-port-phase2-oauth.md).
//
// This endpoint is UNAUTHENTICATED and internet-facing: anyone can hit it
// with an arbitrary `state`/`code`/`error`. It only ever forwards the request
// on to a tightly-allowlisted target (a per-profile Firefox extension
// `*.extensions.allizom.org` origin) — never to an arbitrary URL — so it
// cannot be used as an open redirect. It never reads or writes cookies or
// storage, and never logs the auth code.

const MAX_STATE_LENGTH = 2048;
const MAX_CODE_LENGTH = 2048;
const MAX_ERROR_LENGTH = 256;
const ALLOWED_TARGET_SUFFIX = '.extensions.allizom.org';

function badRequest() {
  return new Response(JSON.stringify({ error: 'invalid_request' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// state is base64url JSON `{ t: <target url>, n: <nonce> }`. The Worker only
// ever extracts `t` to decide where to redirect; it treats `n` as opaque and
// echoes the whole original state string back verbatim.
function parseState(rawState) {
  if (typeof rawState !== 'string' || rawState.length === 0 || rawState.length > MAX_STATE_LENGTH) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(b64uDecode(rawState));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.t !== 'string') return null;
  return parsed;
}

// Only a genuine per-profile Firefox extension redirect origin
// (https://<uuid>.extensions.allizom.org/) may be redirected to. The suffix
// check is dot-prefixed (`.extensions.allizom.org`) specifically so it
// cannot be satisfied by a lookalike label (`xextensions.allizom.org`) or by
// the allowed domain merely appearing as a prefix of an attacker-controlled
// host (`evil-extensions.allizom.org.evil.com`) — both fail this check
// because URL parsing resolves the true hostname first, and endsWith()
// requires the literal leading dot to be part of the host.
function isValidTarget(rawTarget) {
  try {
    const u = new URL(rawTarget);
    return u.protocol === 'https:' && u.hostname.endsWith(ALLOWED_TARGET_SUFFIX);
  } catch {
    return false;
  }
}

export async function handleAuthCallback(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const rawState = url.searchParams.get('state');

  if (!code && !error) return badRequest();
  if (code !== null && code.length > MAX_CODE_LENGTH) return badRequest();
  if (error !== null && error.length > MAX_ERROR_LENGTH) return badRequest();

  const state = parseState(rawState);
  if (!state) return badRequest();
  if (!isValidTarget(state.t)) return badRequest();

  const dest = new URL(state.t);
  // The target came from client-controlled state; strip any embedded
  // userinfo (`user:pass@host`) before redirecting so it can never be used
  // to smuggle credentials or confuse a downstream URL parser.
  dest.username = '';
  dest.password = '';
  if (error) {
    dest.searchParams.set('error', error);
  } else {
    dest.searchParams.set('code', code);
  }
  // Echo the ORIGINAL state string verbatim (never re-serialized) so the
  // extension can verify its nonce; this is a 302 header value only — it is
  // never rendered into an HTML body.
  dest.searchParams.set('state', rawState);

  return new Response(null, {
    status: 302,
    headers: { Location: dest.toString(), 'Cache-Control': 'no-store' },
  });
}
