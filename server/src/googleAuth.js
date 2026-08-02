export async function verifyGoogleToken(accessToken, clientId, fetchImpl = fetch) {
  try {
    const tokenInfoRes = await fetchImpl(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!tokenInfoRes.ok) return null;
    const info = await tokenInfoRes.json();
    if (info.aud !== clientId) return null;

    const aboutRes = await fetchImpl('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!aboutRes.ok) return null;
    const { user } = await aboutRes.json();
    if (!user || !user.permissionId) return null;
    return {
      googleId: user.permissionId,
      email: user.emailAddress || null,
      firstName: firstNameFromDisplayName(user.displayName),
    };
  } catch {
    return null;
  }
}

export function firstNameFromDisplayName(displayName) {
  if (typeof displayName !== 'string') return null;
  const [firstName = ''] = displayName.trim().split(/\s+/);
  return firstName ? firstName.slice(0, 100) : null;
}

// Server-side OAuth token exchange. The extension never sees the client
// secret — it sends { grant_type, code, redirect_uri } or
// { grant_type, refresh_token } and the worker attaches credentials here.
// Google's status/body pass through verbatim so the extension's existing
// invalid_grant / 401 handling keeps working unchanged.
export async function exchangeGoogleToken(params, { clientId, clientSecret }, fetchImpl = fetch) {
  const invalid = { status: 400, body: { error: 'invalid_request' } };
  if (!params || typeof params !== 'object') return invalid;

  const request = { client_id: clientId, client_secret: clientSecret };
  if (params.grant_type === 'authorization_code') {
    if (!params.code || typeof params.code !== 'string') return invalid;
    if (!isExtensionRedirect(params.redirect_uri)) return invalid;
    request.grant_type = 'authorization_code';
    request.code = params.code;
    request.redirect_uri = params.redirect_uri;
  } else if (params.grant_type === 'refresh_token') {
    if (!params.refresh_token || typeof params.refresh_token !== 'string') return invalid;
    request.grant_type = 'refresh_token';
    request.refresh_token = params.refresh_token;
  } else {
    return invalid;
  }

  try {
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: 502, body: { error: 'upstream_error' } };
  }
}

// browser.identity.getRedirectURL() is always https://<ext-id>.chromiumapp.org/…
// (Chrome and Edge builds have different ids, so match the suffix, not one id).
function isExtensionRedirect(uri) {
  if (typeof uri !== 'string') return false;
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && u.hostname.endsWith('.chromiumapp.org');
  } catch {
    return false;
  }
}
