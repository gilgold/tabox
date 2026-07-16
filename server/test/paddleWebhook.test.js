import { describe, it, expect } from 'vitest';
import { verifyPaddleSignature, extractEntitlementUpdate, shouldApply } from '../src/paddleWebhook.js';

const SECRET = 'whsec_test';
async function sign(body, ts) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyPaddleSignature', () => {
  it('accepts a correctly signed fresh payload', async () => {
    const body = '{"a":1}';
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await sign(body, ts);
    expect(await verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, SECRET)).toBe(true);
  });

  it('rejects tampered body, wrong secret, stale ts, and malformed header', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const h1 = await sign('{"a":1}', ts);
    expect(await verifyPaddleSignature('{"a":2}', `ts=${ts};h1=${h1}`, SECRET)).toBe(false);
    expect(await verifyPaddleSignature('{"a":1}', `ts=${ts};h1=${h1}`, 'other')).toBe(false);
    const staleTs = ts - 1000;
    expect(await verifyPaddleSignature('{"a":1}', `ts=${staleTs};h1=${await sign('{"a":1}', staleTs)}`, SECRET)).toBe(false);
    expect(await verifyPaddleSignature('{"a":1}', null, SECRET)).toBe(false);
    expect(await verifyPaddleSignature('{"a":1}', 'garbage', SECRET)).toBe(false);
  });
});

const PRICES = { monthly: 'pri_m', annual: 'pri_a' };
const subEvent = (overrides = {}) => ({
  event_id: 'evt_1',
  event_type: 'subscription.updated',
  occurred_at: '2026-07-16T10:00:00Z',
  data: {
    id: 'sub_1',
    status: 'active',
    customer_id: 'ctm_1',
    custom_data: { googleId: 'g-123' },
    current_billing_period: { ends_at: '2026-08-16T10:00:00Z' },
    items: [{ price: { id: 'pri_m' } }],
    ...overrides,
  },
});

describe('extractEntitlementUpdate', () => {
  it('maps a subscription event to a KV record', () => {
    expect(extractEntitlementUpdate(subEvent(), PRICES)).toEqual({
      googleId: 'g-123',
      record: {
        status: 'active', plan: 'monthly',
        current_period_end: '2026-08-16T10:00:00Z',
        subscription_id: 'sub_1', customer_id: 'ctm_1',
        occurred_at: '2026-07-16T10:00:00Z',
      },
    });
  });

  it('maps annual price id and unknown price to plan null', () => {
    expect(extractEntitlementUpdate(subEvent({ items: [{ price: { id: 'pri_a' } }] }), PRICES).record.plan).toBe('annual');
    expect(extractEntitlementUpdate(subEvent({ items: [{ price: { id: 'pri_x' } }] }), PRICES).record.plan).toBeNull();
  });

  it('ignores non-subscription events and events without googleId', () => {
    expect(extractEntitlementUpdate({ event_type: 'transaction.completed', data: {} }, PRICES)).toBeNull();
    expect(extractEntitlementUpdate(subEvent({ custom_data: {} }), PRICES)).toBeNull();
  });
});

describe('shouldApply', () => {
  it('applies when no existing record or incoming is newer/equal', () => {
    const incoming = { occurred_at: '2026-07-16T10:00:00Z' };
    expect(shouldApply(null, incoming)).toBe(true);
    expect(shouldApply({ occurred_at: '2026-07-16T09:00:00Z' }, incoming)).toBe(true);
    expect(shouldApply({ occurred_at: '2026-07-16T10:00:00Z' }, incoming)).toBe(true);
  });
  it('skips out-of-order (older) events', () => {
    expect(shouldApply({ occurred_at: '2026-07-16T11:00:00Z' }, { occurred_at: '2026-07-16T10:00:00Z' })).toBe(false);
  });
});
