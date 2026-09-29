import { describe, it, expect } from 'vitest';
import { decideEntitlement, PAST_DUE_GRACE_MS } from '../src/entitlement.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T12:00:00Z');

describe('decideEntitlement', () => {
  it('returns not entitled for missing record', () => {
    expect(decideEntitlement(null, NOW)).toEqual({ entitled: false, status: 'none', plan: null, expiresAt: null, cancelAt: null });
  });

  it('entitles trialing and active', () => {
    for (const status of ['trialing', 'active']) {
      const r = decideEntitlement({ status, plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z' }, NOW);
      expect(r).toEqual({ entitled: true, status, plan: 'monthly', expiresAt: '2026-08-01T00:00:00Z', cancelAt: null });
    }
  });

  it('passes a scheduled cancellation through on entitled records', () => {
    const r = decideEntitlement(
      { status: 'trialing', plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z', scheduled_cancel_at: '2026-08-01T00:00:00Z' },
      NOW,
    );
    expect(r.entitled).toBe(true);
    expect(r.cancelAt).toBe('2026-08-01T00:00:00Z');
  });

  it('entitles past_due within the grace window counted from the failed renewal', () => {
    const periodStart = new Date(NOW - 2 * DAY).toISOString();
    const r = decideEntitlement(
      { status: 'past_due', plan: 'monthly', current_period_start: periodStart, current_period_end: '2026-08-14T12:00:00Z' },
      NOW,
    );
    expect(r.entitled).toBe(true);
    expect(Date.parse(r.expiresAt)).toBe(Date.parse(periodStart) + PAST_DUE_GRACE_MS);
  });

  it('does not extend annual past_due access to the unpaid period end', () => {
    // Paddle advances the period on renewal, so a failed annual renewal has
    // current_period_end a year out. Grace must still end a week after the start.
    const periodStart = new Date(NOW - 8 * DAY).toISOString();
    const r = decideEntitlement(
      { status: 'past_due', plan: 'annual', current_period_start: periodStart, current_period_end: '2027-07-08T12:00:00Z' },
      NOW,
    );
    expect(r.entitled).toBe(false);
  });

  it('falls back to occurred_at for records stored without current_period_start', () => {
    const base = { status: 'past_due', plan: 'annual', current_period_end: '2027-07-14T12:00:00Z' };
    expect(decideEntitlement({ ...base, occurred_at: new Date(NOW - 1 * DAY).toISOString() }, NOW).entitled).toBe(true);
    expect(decideEntitlement({ ...base, occurred_at: new Date(NOW - 8 * DAY).toISOString() }, NOW).entitled).toBe(false);
    expect(decideEntitlement(base, NOW).entitled).toBe(false);
  });

  it('rejects canceled and paused', () => {
    for (const status of ['canceled', 'paused']) {
      expect(decideEntitlement({ status, plan: 'monthly', current_period_end: '2026-08-01T00:00:00Z' }, NOW).entitled).toBe(false);
    }
  });
});
