import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import { signPurposeToken, verifyPurposeToken } from '../src/jwt.js';
import {
  isCancelEvent, sentKey, surveyLink, notifyCancelSurvey, handleCancelSurveySubmit, SURVEY_PURPOSE,
} from '../src/cancelSurvey.js';
import { cancelSurveyEmail } from '../src/cancelSurveyEmail.js';
import worker from '../src/index.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => (k in store ? JSON.stringify(store[k]) : null)),
  put: vi.fn(async (k, v) => { store[k] = JSON.parse(v); }),
  _store: store,
});
const ENV_BASE = { JWT_SECRET: 'jwt_secret', PADDLE_API_BASE: 'https://paddle.test', PADDLE_API_KEY: 'k', RESEND_API_KEY: 're_test' };
const PRICE_MAP = { monthly: 'pri_m', annual: 'pri_a' };

const scheduledCancel = {
  event_type: 'subscription.updated',
  data: {
    id: 'sub_1', customer_id: 'ctm_1', status: 'active',
    scheduled_change: { action: 'cancel', effective_at: '2026-10-28T00:00:00Z' },
    items: [{ price: { id: 'pri_m' } }],
  },
};
const immediateCancel = {
  event_type: 'subscription.canceled',
  data: { id: 'sub_1', customer_id: 'ctm_1', status: 'canceled', scheduled_change: null, items: [{ price: { id: 'pri_a' } }] },
};

const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
function mockFetch({ customer = { email: 'dana@example.com', name: 'Dana Levi' }, resendStatus = 200 } = {}) {
  globalThis.fetch = vi.fn(async (input) => {
    const u = String(input);
    if (u === 'https://paddle.test/customers/ctm_1') return customer ? res(200, { data: customer }) : res(404, {});
    if (u === 'https://api.resend.com/emails') return res(resendStatus, { id: 'em_1' });
    throw new Error(`unexpected fetch ${u}`);
  });
}
const resendCalls = () => globalThis.fetch.mock.calls.filter(([u]) => String(u) === 'https://api.resend.com/emails');
const row = (db, sid = 'sub_1') => db._raw.prepare('SELECT * FROM cancel_surveys WHERE subscription_id = ?').get(sid);
const submit = (body) => new Request('https://api.test/survey/cancel', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('isCancelEvent', () => {
  it('matches scheduled and immediate cancels only', () => {
    expect(isCancelEvent(scheduledCancel)).toBe(true);
    expect(isCancelEvent(immediateCancel)).toBe(true);
    expect(isCancelEvent({ ...scheduledCancel, data: { ...scheduledCancel.data, scheduled_change: null } })).toBe(false);
    expect(isCancelEvent({ ...scheduledCancel, data: { ...scheduledCancel.data, scheduled_change: { action: 'pause' } } })).toBe(false);
    expect(isCancelEvent({ event_type: 'subscription.past_due', data: scheduledCancel.data })).toBe(false);
    expect(isCancelEvent(null)).toBe(false);
  });
});

describe('surveyLink', () => {
  it('defaults to tabox.co and keeps existing query params', () => {
    expect(surveyLink({}, 'a.b.c')).toBe('https://www.tabox.co/cancel-survey?t=a.b.c');
    expect(surveyLink({ SURVEY_URL: 'https://www.tabox.co/cancel-survey?env=sandbox' }, 'a.b.c'))
      .toBe('https://www.tabox.co/cancel-survey?env=sandbox&t=a.b.c');
  });
});

describe('cancelSurveyEmail', () => {
  it('mentions the access end date when given', () => {
    const m = cancelSurveyEmail({ name: 'Dana Levi', accessUntil: '2026-10-28T00:00:00Z', surveyUrl: 'https://x/s?t=1' });
    expect(m.subject).toBe('Quick question about cancelling Tabox Pro');
    expect(m.text).toContain('Hi Dana');
    expect(m.text).toContain('October 28, 2026');
    expect(m.text).toContain('https://x/s?t=1');
    expect(cancelSurveyEmail({ name: null, accessUntil: null, surveyUrl: 'u' }).text).not.toContain('You keep Pro until');
  });
});

describe('notifyCancelSurvey', () => {
  beforeEach(() => mockFetch());

  it('emails the customer a signed survey link and records the send in D1', async () => {
    const kv = makeKV();
    const db = makeDB();
    const out = await notifyCancelSurvey({ ...ENV_BASE, ENTITLEMENTS: kv, SHARED_DB: db }, scheduledCancel, PRICE_MAP, NOW);
    expect(out).toEqual({ sent: true });
    const payload = JSON.parse(resendCalls()[0][1].body);
    expect(payload).toMatchObject({ from: 'Tabox <info@tabox.co>', to: ['dana@example.com'], reply_to: 'info@tabox.co' });
    const link = payload.text.match(/https:\/\/www\.tabox\.co\/cancel-survey\?t=\S+/)[0];
    const t = new URL(link).searchParams.get('t');
    expect((await verifyPurposeToken(SURVEY_PURPOSE, t, 'jwt_secret', NOW)).sid).toBe('sub_1');
    expect(kv._store[sentKey('sub_1')]).toBeTruthy();
    expect(row(db)).toMatchObject({ email: 'dana@example.com', plan: 'monthly', emailed_at: NOW, reason: null });
  });

  it('sends once per subscription (scheduled cancel then final canceled event)', async () => {
    const env = { ...ENV_BASE, ENTITLEMENTS: makeKV(), SHARED_DB: makeDB() };
    await notifyCancelSurvey(env, scheduledCancel, PRICE_MAP, NOW);
    expect(await notifyCancelSurvey(env, immediateCancel, PRICE_MAP, NOW)).toEqual({ sent: false, reason: 'already_sent' });
    expect(resendCalls()).toHaveLength(1);
  });

  it('does not mark as sent when Resend fails', async () => {
    mockFetch({ resendStatus: 500 });
    const kv = makeKV();
    expect(await notifyCancelSurvey({ ...ENV_BASE, ENTITLEMENTS: kv, SHARED_DB: makeDB() }, scheduledCancel, PRICE_MAP, NOW))
      .toEqual({ sent: false, reason: 'error' });
    expect(Object.keys(kv._store)).toHaveLength(0);
  });

  it('still sends when D1 is unavailable', async () => {
    expect(await notifyCancelSurvey({ ...ENV_BASE, ENTITLEMENTS: makeKV() }, scheduledCancel, PRICE_MAP, NOW)).toEqual({ sent: true });
  });

  it('skips non-cancel events, missing Resend key and missing email', async () => {
    const env = { ...ENV_BASE, ENTITLEMENTS: makeKV(), SHARED_DB: makeDB() };
    expect((await notifyCancelSurvey(env, { event_type: 'subscription.updated', data: { id: 's', customer_id: 'c' } }, PRICE_MAP)).reason).toBe('not_applicable');
    expect((await notifyCancelSurvey({ ...env, RESEND_API_KEY: undefined }, scheduledCancel, PRICE_MAP)).reason).toBe('no_resend_key');
    mockFetch({ customer: null });
    expect((await notifyCancelSurvey(env, scheduledCancel, PRICE_MAP)).reason).toBe('no_email');
  });
});

describe('handleCancelSurveySubmit', () => {
  let db, env, token;
  beforeEach(async () => {
    db = makeDB();
    env = { ...ENV_BASE, SHARED_DB: db };
    token = await signPurposeToken(SURVEY_PURPOSE, { sid: 'sub_1' }, 'jwt_secret', 3600, NOW);
  });

  it('stores the answer on the existing row and overwrites on resubmit', async () => {
    db._raw.prepare('INSERT INTO cancel_surveys (subscription_id, email, plan, emailed_at) VALUES (?, ?, ?, ?)').run('sub_1', 'dana@example.com', 'monthly', NOW - 1000);
    expect(await handleCancelSurveySubmit(submit({ t: token, reason: 'too_expensive', comment: '  pricey  ' }), env, NOW))
      .toEqual({ status: 200, body: { ok: true } });
    expect(row(db)).toMatchObject({ email: 'dana@example.com', reason: 'too_expensive', comment: 'pricey', responded_at: NOW });
    await handleCancelSurveySubmit(submit({ t: token, reason: 'bugs' }), env, NOW + 5);
    expect(row(db)).toMatchObject({ reason: 'bugs', comment: null, responded_at: NOW + 5, email: 'dana@example.com' });
  });

  it('inserts a row when the send-time row is missing', async () => {
    await handleCancelSurveySubmit(submit({ t: token, reason: 'not_using' }), env, NOW);
    expect(row(db)).toMatchObject({ email: null, reason: 'not_using', emailed_at: NOW, responded_at: NOW });
  });

  it('rejects bad input', async () => {
    expect((await handleCancelSurveySubmit(submit('not json'), env, NOW)).status).toBe(400);
    expect((await handleCancelSurveySubmit(submit({ t: 'bad', reason: 'bugs' }), env, NOW)).body).toEqual({ error: 'invalid_token' });
    expect((await handleCancelSurveySubmit(submit({ t: token, reason: 'other' }), env, NOW)).body).toEqual({ error: 'invalid_reason' });
    expect((await handleCancelSurveySubmit(submit({ t: token, reason: 'bugs', comment: 'x'.repeat(2001) }), env, NOW)).body).toEqual({ error: 'comment_too_long' });
    expect((await handleCancelSurveySubmit(submit({ t: token, reason: 'bugs' }), { ...ENV_BASE }, NOW)).status).toBe(503);
  });
});

describe('Worker wiring', () => {
  async function signWebhook(body, secret, ts) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const WH_ENV = { ...ENV_BASE, PRICE_MONTHLY: 'pri_m', PRICE_ANNUAL: 'pri_a', PADDLE_WEBHOOK_SECRET: 'whsec_test' };

  it('schedules the survey email for a scheduled cancel webhook', async () => {
    mockFetch();
    const body = JSON.stringify({ event_id: 'evt_c', occurred_at: '2026-09-29T12:00:00Z', ...scheduledCancel });
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await signWebhook(body, 'whsec_test', ts);
    const pending = [];
    const r = await worker.fetch(
      new Request('https://api.test/webhooks/paddle', { method: 'POST', body, headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` } }),
      { ...WH_ENV, ENTITLEMENTS: makeKV(), SHARED_DB: makeDB() },
      { waitUntil: (p) => pending.push(p) }
    );
    expect(r.status).toBe(200);
    await Promise.all(pending);
    expect(resendCalls()).toHaveLength(1);
  });

  it('routes POST /survey/cancel with CORS', async () => {
    const db = makeDB();
    const t = await signPurposeToken(SURVEY_PURPOSE, { sid: 'sub_9' }, 'jwt_secret', 3600);
    const r = await worker.fetch(submit({ t, reason: 'missing_feature', comment: 'sync to Safari' }), { ...WH_ENV, SHARED_DB: db, ENTITLEMENTS: makeKV() }, { waitUntil() {} });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(row(db, 'sub_9')).toMatchObject({ reason: 'missing_feature', comment: 'sync to Safari' });
  });
});
