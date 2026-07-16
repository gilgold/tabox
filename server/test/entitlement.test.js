import { describe, it, expect } from 'vitest';
import { decideEntitlement, PAST_DUE_GRACE_MS } from '../src/entitlement.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T12:00:00Z');

describe('decideEntitlement', () => {
  it('returns not entitled for missing record', () => {
    expect(decideEntitlement(null, NOW)).toEqual({ entitled: false, status: 'none', plan: null, expiresAt: null });
  });

  it('entitles trialing and active', () => {
    for (const status of ['trialing', 'active']) {
      const r = decideEntitlement({ status, plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z' }, NOW);
      expect(r).toEqual({ entitled: true, status, plan: 'monthly', expiresAt: '2026-08-01T00:00:00Z' });
    }
  });

  it('entitles past_due within 14 days of period end', () => {
    const periodEnd = new Date(NOW - 5 * DAY).toISOString();
    const r = decideEntitlement({ status: 'past_due', plan: 'annual', current_period_end: periodEnd }, NOW);
    expect(r.entitled).toBe(true);
    expect(Date.parse(r.expiresAt)).toBe(Date.parse(periodEnd) + PAST_DUE_GRACE_MS);
  });

  it('rejects past_due beyond the grace window', () => {
    const periodEnd = new Date(NOW - 15 * DAY).toISOString();
    expect(decideEntitlement({ status: 'past_due', plan: 'annual', current_period_end: periodEnd }, NOW).entitled).toBe(false);
  });

  it('rejects canceled and paused', () => {
    for (const status of ['canceled', 'paused']) {
      expect(decideEntitlement({ status, plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z' }, NOW).entitled).toBe(false);
    }
  });
});
