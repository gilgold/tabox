// Web Push sender: RFC 8292 VAPID auth + RFC 8291 aes128gcm payload
// encryption, hand-rolled on WebCrypto (no deps). Payloads are content-free
// tickles; sends run in ctx.waitUntil at call sites and must never throw.

const enc = new TextEncoder();

function b64uEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concatBytes(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function vapidAuthHeader(env, endpoint) {
  const { origin } = new URL(endpoint);
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
    enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64uEncode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// RFC 8291 single-record aes128gcm encryption.
async function encryptPayload(sub, payloadBytes) {
  const uaPublic = b64uDecode(sub.p256dh);   // 65-byte uncompressed P-256 point
  const authSecret = b64uDecode(sub.auth);   // 16 bytes
  const asKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret,
    concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concatBytes(payloadBytes, new Uint8Array([2])); // 0x02: last-record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, record));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export async function sendWebPush(env, sub, payloadObj) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payloadObj)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '60',
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

export async function notifyEmails(env, db, emails, payload) {
  try {
    const unique = [...new Set(emails.map((e) => String(e || '').toLowerCase()).filter(Boolean))];
    if (!unique.length) return;
    const placeholders = unique.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_email IN (${placeholders})`
    ).bind(...unique).all();
    await Promise.all((results || []).map(async (row) => {
      try {
        const status = await sendWebPush(env, row, payload);
        if (status === 404 || status === 410) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
            .bind(row.endpoint).run();
        }
      } catch (err) {
        console.error('web push send failed:', err);
      }
    }));
  } catch (err) {
    console.error('notifyEmails failed:', err);
  }
}

export async function notifyFolderMembers(env, db, folderId, { exceptEmail, payload, extraEmails = [] }) {
  try {
    const { results } = await db.prepare(
      "SELECT email FROM shared_members WHERE folder_id = ? AND status = 'active'"
    ).bind(folderId).all();
    // The owner is NOT a shared_members row (only guests are) — owner_email
    // lives on shared_folders — so union it in here before the exceptEmail
    // filter, or the owner never gets tickled for other members' edits.
    const folder = await db.prepare('SELECT owner_email FROM shared_folders WHERE id = ?')
      .bind(folderId).first();
    const memberEmails = (results || []).map((r) => r.email);
    const allEmails = folder && folder.owner_email
      ? [...memberEmails, folder.owner_email]
      : memberEmails;
    const except = String(exceptEmail || '').toLowerCase();
    const emails = allEmails.filter((e) => e.toLowerCase() !== except);
    // extraEmails must go through the same exceptEmail filter — otherwise a
    // future caller passing the actor's own email in extraEmails would
    // reintroduce the self-tickle this function is meant to prevent.
    const filteredExtra = extraEmails.filter((e) => String(e || '').toLowerCase() !== except);
    await notifyEmails(env, db, [...emails, ...filteredExtra], payload);
  } catch (err) {
    console.error('notifyFolderMembers failed:', err);
  }
}
