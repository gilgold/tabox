import { describe, it, expect } from 'vitest';
import { signEntitlementToken } from '../src/jwt.js';

const decode = (part) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));

describe('signEntitlementToken', () => {
  it('produces a three-part HS256 JWT with 7-day expiry', async () => {
    const now = Date.parse('2026-07-16T12:00:00Z');
    const jwt = await signEntitlementToken({ sub: 'g-123', plan: 'monthly' }, 'secret', now);
    const [h, p, s] = jwt.split('.');
    expect(s.length).toBeGreaterThan(0);
    expect(decode(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const payload = decode(p);
    expect(payload.sub).toBe('g-123');
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
    expect(payload.iat).toBe(Math.floor(now / 1000));
  });

  it('changes signature when secret changes', async () => {
    const a = await signEntitlementToken({ sub: 'x' }, 'one', 1000000000000);
    const b = await signEntitlementToken({ sub: 'x' }, 'two', 1000000000000);
    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });
});
