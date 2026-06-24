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

module.exports = { createOrder, fetchPayment, PLAN_PRICES_PAISE, TOPUP_PRICES_PAISE };
