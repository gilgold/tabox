export const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export function decideEntitlement(record, nowMs = Date.now()) {
  if (!record || !record.status) {
    return { entitled: false, status: 'none', plan: null, expiresAt: null };
  }
  const { status, plan = null, current_period_end = null } = record;
  if (status === 'trialing' || status === 'active') {
    return { entitled: true, status, plan, expiresAt: current_period_end };
  }
  if (status === 'past_due' && current_period_end) {
    const graceEnd = Date.parse(current_period_end) + PAST_DUE_GRACE_MS;
    if (nowMs <= graceEnd) {
      return { entitled: true, status, plan, expiresAt: new Date(graceEnd).toISOString() };
    }
  }
  return { entitled: false, status, plan, expiresAt: null };
}
