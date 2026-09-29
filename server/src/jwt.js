const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const TOKEN_TTL_S = 7 * 24 * 60 * 60;

export async function signEntitlementToken(payload, secret, nowMs = Date.now()) {
  const enc = new TextEncoder();
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat, exp: iat + TOKEN_TTL_S })));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

const b64urlDecode = (s) => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0));
};

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

// General-purpose HS256 token with an explicit TTL. `pur` scopes a token to one
// use so a token minted for one route is never accepted by another.
export async function signPurposeToken(pur, payload, secret, ttlS, nowMs = Date.now()) {
  const enc = new TextEncoder();
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, pur, iat, exp: iat + ttlS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

// Returns the payload, or null when the token is malformed, forged, expired or
// minted for a different purpose.
export async function verifyPurposeToken(pur, token, secret, nowMs = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${body}`)
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (!payload || payload.pur !== pur) return null;
  if (typeof payload.exp !== 'number' || nowMs / 1000 > payload.exp) return null;
  return payload;
}
