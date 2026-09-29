// Resend sender shared by the Worker's transactional emails.
export const FROM = 'Tabox <info@tabox.co>';
export const REPLY_TO = 'info@tabox.co';

export async function sendResend(env, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`resend_${res.status}: ${await res.text().catch(() => '')}`);
}
