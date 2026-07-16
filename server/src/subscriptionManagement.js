// Tabox Pro subscription management — thin wrapper over the Paddle API.
// The Worker resolves the caller's subscription from their own KV entitlement
// record (ent:<googleId>), so clients never send Paddle IDs and no separate
// ownership check is needed.

// Paddle API call. Returns { ok, data } or { ok: false, status, detail }.
export async function paddleFetch(env, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${env.PADDLE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.PADDLE_API_KEY}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 502, detail: 'paddle_unreachable' };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = (json && json.error && (json.error.detail || json.error.code)) || `paddle_error_${res.status}`;
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, data: json && json.data };
}

export function planFromPriceId(priceId, priceMap) {
  if (priceId === priceMap.monthly) return 'monthly';
  if (priceId === priceMap.annual) return 'annual';
  return null;
}

// Slim DTO — never return the raw Paddle subscription to the extension.
export function toSubscriptionDto(sub, priceMap) {
  const priceId = (sub.items && sub.items[0] && sub.items[0].price && sub.items[0].price.id) || null;
  return {
    plan: planFromPriceId(priceId, priceMap),
    status: sub.status,
    next_billed_at: sub.next_billed_at || null,
    current_period_end: (sub.current_billing_period && sub.current_billing_period.ends_at) || null,
    scheduled_change: sub.scheduled_change
      ? { action: sub.scheduled_change.action, effective_at: sub.scheduled_change.effective_at || null }
      : null,
    update_payment_method_url: (sub.management_urls && sub.management_urls.update_payment_method) || null,
  };
}

// monthly→annual charges the prorated difference now; annual→monthly waits for
// renewal so we never issue a mid-period refund. Trialing subscriptions have
// paid nothing yet — Paddle only allows do_not_bill for billing-cycle changes
// during trial (the new price simply bills when the trial ends).
export function prorationModeFor(targetPlan, subscriptionStatus) {
  if (subscriptionStatus === 'trialing') return 'do_not_bill';
  return targetPlan === 'annual' ? 'prorated_immediately' : 'prorated_next_billing_period';
}

// Slim DTO for a plan-change preview. update_summary.result is the net amount
// Paddle will charge (or credit) now; recurring_transaction_details is the
// ongoing price after the switch.
export function toPreviewDto(preview) {
  const result = preview.update_summary && preview.update_summary.result;
  const recurring = preview.recurring_transaction_details && preview.recurring_transaction_details.totals;
  return {
    immediate: result
      ? { action: result.action, amount: result.amount, currency: result.currency_code }
      : null,
    recurring: recurring
      ? { amount: recurring.total, currency: recurring.currency_code }
      : null,
    next_billed_at: preview.next_billed_at || null,
  };
}

export async function getSubscription(env, subscriptionId) {
  return paddleFetch(env, `/subscriptions/${subscriptionId}`);
}

export async function cancelSubscription(env, subscriptionId) {
  return paddleFetch(env, `/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: { effective_from: 'next_billing_period' },
  });
}

export async function resumeSubscription(env, subscriptionId) {
  return paddleFetch(env, `/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: { scheduled_change: null },
  });
}

export async function changePlan(env, subscriptionId, targetPriceId, targetPlan, { preview = false, subscriptionStatus } = {}) {
  const body = {
    items: [{ price_id: targetPriceId, quantity: 1 }],
    proration_billing_mode: prorationModeFor(targetPlan, subscriptionStatus),
  };
  if (preview) {
    return paddleFetch(env, `/subscriptions/${subscriptionId}/preview`, { method: 'PATCH', body });
  }
  return paddleFetch(env, `/subscriptions/${subscriptionId}`, { method: 'PATCH', body });
}
