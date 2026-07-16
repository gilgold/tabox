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
    return { googleId: user.permissionId, email: user.emailAddress || null };
  } catch {
    return null;
  }
}
