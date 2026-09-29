// Backstop only: Paddle's dunning cancels a past_due subscription (~4 days in
// practice) and the subscription.canceled webhook ends access. This window just
// has to outlast that, so a missed cancel webhook can't leave Pro on.
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// When a renewal fails Paddle has already advanced current_billing_period to
// the unpaid period, so the grace window counts from that period's start (the
// failed renewal), not its end — an annual plan's end is a year away. Records
// written before current_period_start was stored fall back to occurred_at.
function pastDueSince(record) {
  const start = Date.parse(record.current_period_start);
  if (!Number.isNaN(start)) return start;
  const occurred = Date.parse(record.occurred_at);
  return Number.isNaN(occurred) ? null : occurred;
}

export function decideEntitlement(record, nowMs = Date.now()) {
  if (!record || !record.status) {
    return { entitled: false, status: 'none', plan: null, expiresAt: null, cancelAt: null };
  }
  const { status, plan = null, current_period_end = null, scheduled_cancel_at = null } = record;
  if (status === 'trialing' || status === 'active') {
    return { entitled: true, status, plan, expiresAt: current_period_end, cancelAt: scheduled_cancel_at };
  }
  if (status === 'past_due') {
    const since = pastDueSince(record);
    const graceEnd = since === null ? null : since + PAST_DUE_GRACE_MS;
    if (graceEnd !== null && nowMs <= graceEnd) {
      return { entitled: true, status, plan, expiresAt: new Date(graceEnd).toISOString(), cancelAt: scheduled_cancel_at };
    }
  }
  return { entitled: false, status, plan, expiresAt: null, cancelAt: null };
}
