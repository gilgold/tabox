// Cancellation survey. The Paddle webhook calls notifyCancelSurvey (under
// ctx.waitUntil) when a subscription is cancelled. It emails a signed link to
// the tabox.co /cancel-survey page and records the send in D1. That page
// POSTs /survey/cancel, handled by handleCancelSurveySubmit, which stores the
// answer. The War Room reads cancel_surveys directly.
import { paddleFetch, planFromPriceId } from './subscriptionManagement.js';
import { signPurposeToken, verifyPurposeToken } from './jwt.js';
import { FROM, REPLY_TO, sendResend } from './resend.js';
import { cancelSurveyEmail } from './cancelSurveyEmail.js';

export const SURVEY_PURPOSE = 'cancel-survey';
export const SURVEY_REASONS = ['too_expensive', 'not_using', 'missing_feature', 'bugs'];
const LINK_TTL_S = 60 * 24 * 60 * 60;
// A scheduled cancel later also fires subscription.canceled; one email covers both.
const SENT_TTL_S = 90 * 24 * 60 * 60;
const MAX_COMMENT = 2000;
const DEFAULT_SURVEY_URL = 'https://www.tabox.co/cancel-survey';

// subscription.updated with a scheduled cancel = the user clicked cancel.
// subscription.canceled = immediate cancel, or the scheduled one taking effect.
export function isCancelEvent(event) {
  const sub = event && event.data;
  if (!sub || !sub.id || !sub.customer_id) return false;
  if (event.event_type === 'subscription.canceled') return true;
  return event.event_type === 'subscription.updated' && !!(sub.scheduled_change && sub.scheduled_change.action === 'cancel');
}

export const sentKey = (sid) => `cancelsurvey:${sid}`;

export function surveyLink(env, token) {
  const u = new URL(env.SURVEY_URL || DEFAULT_SURVEY_URL);
  u.searchParams.set('t', token);
  return u.toString();
}

function accessUntil(sub, nowMs) {
  const at = sub.scheduled_change && sub.scheduled_change.effective_at;
  return at && Date.parse(at) > nowMs ? at : null;
}

const hasDB = (env) => !!(env.SHARED_DB && typeof env.SHARED_DB.prepare === 'function');

// Never throws — runs under ctx.waitUntil after the webhook has been acked.
export async function notifyCancelSurvey(env, event, priceMap, nowMs = Date.now()) {
  try {
    if (!isCancelEvent(event)) return { sent: false, reason: 'not_applicable' };
    if (!env.RESEND_API_KEY) {
      console.warn('cancel survey email: RESEND_API_KEY is not set');
      return { sent: false, reason: 'no_resend_key' };
    }
    const sub = event.data;
    if (await env.ENTITLEMENTS.get(sentKey(sub.id))) return { sent: false, reason: 'already_sent' };

    const customer = await paddleFetch(env, `/customers/${sub.customer_id}`);
    const email = customer.ok && customer.data && customer.data.email;
    if (!email) {
      console.warn('cancel survey email: no customer email', sub.id, customer.detail);
      return { sent: false, reason: 'no_email' };
    }

    const token = await signPurposeToken(SURVEY_PURPOSE, { sid: sub.id }, env.JWT_SECRET, LINK_TTL_S, nowMs);
    const mail = cancelSurveyEmail({
      name: customer.data.name,
      accessUntil: accessUntil(sub, nowMs),
      surveyUrl: surveyLink(env, token),
    });
    await sendResend(env, { from: FROM, to: [email], reply_to: REPLY_TO, ...mail });
    await env.ENTITLEMENTS.put(sentKey(sub.id), JSON.stringify({ sent_at: new Date(nowMs).toISOString() }), { expirationTtl: SENT_TTL_S });

    if (hasDB(env)) {
      const priceId = (sub.items && sub.items[0] && sub.items[0].price && sub.items[0].price.id) || null;
      try {
        await env.SHARED_DB
          .prepare(`INSERT INTO cancel_surveys (subscription_id, email, plan, emailed_at) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(subscription_id) DO UPDATE SET email = excluded.email, plan = excluded.plan, emailed_at = excluded.emailed_at`)
          .bind(sub.id, email, planFromPriceId(priceId, priceMap), nowMs)
          .run();
      } catch (err) {
        console.warn('cancel survey: D1 record failed', { message: err && err.message });
      }
    } else {
      console.warn('cancel survey: SHARED_DB not bound; send not recorded');
    }
    return { sent: true };
  } catch (err) {
    console.error('cancel survey email: send failed', err);
    return { sent: false, reason: 'error' };
  }
}

// POST /survey/cancel { t, reason, comment? } → { status, body }
export async function handleCancelSurveySubmit(request, env, nowMs = Date.now()) {
  let input;
  try {
    input = await request.json();
  } catch {
    return { status: 400, body: { error: 'invalid_body' } };
  }
  if (!input || typeof input !== 'object') return { status: 400, body: { error: 'invalid_body' } };
  const payload = await verifyPurposeToken(SURVEY_PURPOSE, input.t, env.JWT_SECRET, nowMs);
  if (!payload || typeof payload.sid !== 'string') return { status: 401, body: { error: 'invalid_token' } };
  if (!SURVEY_REASONS.includes(input.reason)) return { status: 400, body: { error: 'invalid_reason' } };
  if (input.comment != null && typeof input.comment !== 'string') return { status: 400, body: { error: 'invalid_comment' } };
  const comment = (input.comment || '').trim() || null;
  if (comment && comment.length > MAX_COMMENT) return { status: 400, body: { error: 'comment_too_long' } };
  if (!hasDB(env)) return { status: 503, body: { error: 'unavailable' } };

  await env.SHARED_DB
    .prepare(`INSERT INTO cancel_surveys (subscription_id, reason, comment, emailed_at, responded_at) VALUES (?1, ?2, ?3, ?4, ?4)
              ON CONFLICT(subscription_id) DO UPDATE SET reason = excluded.reason, comment = excluded.comment, responded_at = excluded.responded_at`)
    .bind(payload.sid, input.reason, comment, nowMs)
    .run();
  return { status: 200, body: { ok: true } };
}
