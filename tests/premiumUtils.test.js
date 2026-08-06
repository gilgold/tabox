import { isEntitled, isStale, REFRESH_INTERVAL_MS, OFFLINE_GRACE_MS } from '../app/utils/premiumUtils';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T12:00:00Z');
const record = (agoMs, entitled = true) => ({ entitled, status: 'active', refreshedAt: new Date(NOW - agoMs).toISOString() });

describe('isEntitled', () => {
  it('false for null, non-entitled, or missing/invalid refreshedAt', () => {
    expect(isEntitled(null, NOW)).toBe(false);
    expect(isEntitled(record(0, false), NOW)).toBe(false);
    expect(isEntitled({ entitled: true }, NOW)).toBe(false);
    expect(isEntitled({ entitled: true, refreshedAt: 'garbage' }, NOW)).toBe(false);
  });

  it('true within refresh window and within the 72h offline grace', () => {
    expect(isEntitled(record(1 * HOUR), NOW)).toBe(true);
    expect(isEntitled(record(REFRESH_INTERVAL_MS / HOUR * HOUR + 71 * HOUR), NOW)).toBe(true); // 24h + 71h old
  });

  it('true at exactly the refresh-by + grace boundary (96h)', () => {
    expect(isEntitled(record(REFRESH_INTERVAL_MS + OFFLINE_GRACE_MS), NOW)).toBe(true);
  });

  it('false once grace is exhausted (24h refresh-by + 72h grace)', () => {
    expect(isEntitled(record(REFRESH_INTERVAL_MS + OFFLINE_GRACE_MS + 1), NOW)).toBe(false);
  });

  it('keys off entitled + refreshedAt only, ignoring status', () => {
    expect(isEntitled({ entitled: true, status: 'canceled', refreshedAt: new Date(NOW - 1 * HOUR).toISOString() }, NOW)).toBe(true);
  });
});

describe('isStale', () => {
  it('true for null or older than the refresh interval; false when fresh', () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(record(25 * HOUR), NOW)).toBe(true);
    expect(isStale(record(1 * HOUR), NOW)).toBe(false);
  });

  it('false at exactly the refresh interval (24h), true just past it', () => {
    expect(isStale(record(REFRESH_INTERVAL_MS), NOW)).toBe(false);
    expect(isStale(record(REFRESH_INTERVAL_MS + 1), NOW)).toBe(true);
  });
});
