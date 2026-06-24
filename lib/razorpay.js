// lib/razorpay.js
//
// Razorpay integration helpers. Uses raw fetch() calls to Razorpay's REST
// API (same pattern as lib/angelone.js) rather than their official SDK —
// keeps the dependency footprint at zero, consistent with the rest of
// this codebase.

const RAZORPAY_BASE = 'https://api.razorpay.com/v1';

function authHeader(){
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set in environment variables.');
  }
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return 'Basic ' + token;
}

// ============================================================
// SERVER-SIDE PRICE TABLES — the only source of truth for amounts.
// The client tells us WHICH plan/top-up it wants (an id), never an
// amount — we look the real price up here so nothing can be tampered
// with from the browser.
// ============================================================
const PLAN_PRICES_PAISE = { basic: 14900, growth: 29900, pro: 59900 }; // ₹149 / ₹299 / ₹599
// price-in-paise -> virtual capital granted (in rupees)
const TOPUP_PRICES_PAISE = { 2900: 100000, 4900: 250000, 9900: 500000, 19900: 1000000, 34900: 2000000 };

async function createOrder({ amountPaise, receipt, notes }){
  const resp = await fetch(RAZORPAY_BASE + '/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error('Razorpay order creation failed: ' + (json.error?.description || JSON.stringify(json)));
  }
  return json;
}

// Independently fetch a payment's real status directly from Razorpay's
// servers, keyed only by payment_id. This is our actual trust boundary —
// see api/razorpay-webhook.js for why we verify this way instead of
// relying on raw-body HMAC matching.
async function fetchPayment(paymentId){
  const resp = await fetch(`${RAZORPAY_BASE}/payments/${paymentId}`, {
    headers: { 'Authorization': authHeader() }
  });
  if (!resp.ok) {
    throw new Error('Could not fetch payment ' + paymentId + ' from Razorpay (status ' + resp.status + ')');
  }
  return resp.json();
}

// ============================================================
// SUBSCRIPTIONS — true recurring auto-billing (Basic/Growth/Pro renew
// automatically every month via UPI AutoPay or saved card, no manual
// "renew" click needed). Top-ups stay as one-time Orders above — they're
// inherently single purchases, not recurring.
// ============================================================

// One-time setup: creates a Razorpay "Plan" entity (the recurring billing
// template). Run once per plan via api/setup-razorpay-plans.js — not
// something a regular user ever triggers.
async function createPlan({ amountPaise, name, period, interval }){
  const resp = await fetch(RAZORPAY_BASE + '/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify({
      period, interval,
      item: { name, amount: amountPaise, currency: 'INR' }
    })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error('Razorpay plan creation failed: ' + (json.error?.description || JSON.stringify(json)));
  }
  return json;
}

// Creates an actual Subscription for a specific user, linked to one of
// the Plans created above. total_count is set high (10 years of monthly
// cycles) to act as effectively indefinite — the user can cancel anytime
// via Razorpay's customer-facing cancellation flow.
async function createSubscription({ planId, totalCount, notes }){
  const resp = await fetch(RAZORPAY_BASE + '/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify({ plan_id: planId, total_count: totalCount, customer_notify: 1, notes })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error('Razorpay subscription creation failed: ' + (json.error?.description || JSON.stringify(json)));
  }
  return json;
}

// Same independent-verification pattern as fetchPayment — never trust the
// webhook body's notes directly, always re-fetch the subscription by ID.
async function fetchSubscription(subscriptionId){
  const resp = await fetch(`${RAZORPAY_BASE}/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': authHeader() }
  });
  if (!resp.ok) {
    throw new Error('Could not fetch subscription ' + subscriptionId + ' from Razorpay (status ' + resp.status + ')');
  }
  return resp.json();
}

// Cancels an active subscription — used when a user downgrades, so they
// stop being auto-charged at their OLD (higher) plan's rate. cancel_at_cycle_end
// false = cancel immediately, not at the end of the current billing cycle.
async function cancelSubscription(subscriptionId){
  const resp = await fetch(`${RAZORPAY_BASE}/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader() },
    body: JSON.stringify({ cancel_at_cycle_end: 0 })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error('Razorpay subscription cancellation failed: ' + (json.error?.description || JSON.stringify(json)));
  }
  return json;
}

module.exports = { createOrder, fetchPayment, createPlan, createSubscription, fetchSubscription, cancelSubscription, PLAN_PRICES_PAISE, TOPUP_PRICES_PAISE };
