// api/razorpay-webhook.js
//
// Handles TWO kinds of Razorpay events:
//   1. payment.captured   — one-time Orders (top-ups, and legacy/manual
//                            plan purchases before Subscriptions existed)
//   2. subscription.charged — true recurring billing (Basic/Growth/Pro),
//                            fires automatically on EVERY successful
//                            charge, first payment included, with zero
//                            manual action from the user.
//
// We deliberately do NOT act on subscription.activated — Razorpay fires
// both subscription.activated AND subscription.charged for the very
// first payment, and acting on both would double-grant. subscription.
// charged alone reliably covers every payment (first + every renewal),
// so it's the single safe event to hang the grant logic on.
//
// VERIFICATION STRATEGY — why this isn't a simple HMAC-on-raw-body check:
// Vercel's plain serverless functions (this codebase doesn't use Next.js)
// have inconsistent/unclear documented behavior around raw request body
// access, which raw-body HMAC verification depends on getting exactly
// right. Rather than risk a subtly-broken signature check, we use IDs
// from the webhook purely as a REFERENCE, then independently ask
// Razorpay's own API "is this real, and what are its real notes?" An
// attacker can send us a fake webhook body, but they cannot fake what
// Razorpay's servers say about a real payment_id/subscription_id — so
// this is resistant to spoofing without depending on raw-body quirks.

const { getDb } = require('../lib/firebase-admin');
const { fetchPayment, fetchSubscription } = require('../lib/razorpay');

const PLAN_START = { trial: 2000000, basic: 500000, growth: 1000000, pro: 2000000 };
const VALID_PLANS = ['trial', 'basic', 'growth', 'pro'];
const ADMIN_EMAILS = ['scaleaiq@gmail.com', 'jitendramathur.85@gmail.com'];
const TOPUP_AMOUNTS = { 2900: 100000, 4900: 250000, 9900: 500000, 19900: 1000000, 34900: 2000000 };

// Shared grant logic — same accumulation rule used everywhere else in the
// app: trial->paid is a fresh start; any paid-plan payment (first time,
// renewal of the same plan, or a genuine upgrade) ADDS the full new
// plan's capital on top of whatever cash the user currently has.
// Holdings are never touched. Returns false if planId was invalid.
async function grantPlan(db, uid, planId, extraUserFields){
  if (!PLAN_START.hasOwnProperty(planId) || planId === 'trial') return false;

  const userRef = db.doc('users/' + uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const currentPlan = VALID_PLANS.includes(userData.plan) ? userData.plan : 'trial';
  const currentCash = typeof userData.cash === 'number' ? userData.cash : PLAN_START.trial;
  const currentCapitalIn = typeof userData.totalCapitalIn === 'number' ? userData.totalCapitalIn : currentCash;
  const now = Date.now();

  let newCash, newCapitalIn;
  if (currentPlan === 'trial') {
    newCash = PLAN_START[planId];
    newCapitalIn = PLAN_START[planId];
  } else {
    newCash = currentCash + PLAN_START[planId];
    newCapitalIn = currentCapitalIn + PLAN_START[planId];
  }

  await userRef.set({
    plan: planId,
    cash: newCash,
    totalCapitalIn: newCapitalIn,
    planStartDate: now,
    lastTopupDate: now,
    dailyTradeDate: null,
    dailyTradeCount: 0,
    ...(extraUserFields || {})
  }, { merge: true });

  const myEmail = (userData.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(myEmail)) {
    const peakForBoard = userData.peakValue || newCash;
    const peakPnlPct = newCapitalIn > 0 ? (peakForBoard - newCapitalIn) / newCapitalIn * 100 : 0;
    await db.doc('leaderboard/' + uid).set({
      displayName: userData.displayName || 'Trader',
      photoURL: userData.photoURL || '',
      totalCapitalIn: newCapitalIn,
      peakValue: peakForBoard,
      peakPnlPct: peakPnlPct,
      plan: planId,
      updatedAt: now
    }, { merge: true });
  }
  return true;
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const event = req.body; // Vercel auto-parses JSON for plain serverless functions
    const db = getDb();
    const now = Date.now();

    // ===== Path 1: one-time Orders (top-ups + any manual/legacy plan buys) =====
    if (event && event.event === 'payment.captured') {
      const paymentIdFromWebhook = event.payload?.payment?.entity?.id;
      if (!paymentIdFromWebhook) {
        return res.status(200).json({ received: true, skipped: true, reason: 'no payment id in webhook' });
      }

      const verifiedPayment = await fetchPayment(paymentIdFromWebhook);
      if (verifiedPayment.status !== 'captured') {
        return res.status(200).json({ received: true, skipped: true, reason: 'payment not captured: ' + verifiedPayment.status });
      }

      const notes = verifiedPayment.notes || {};
      const { uid, kind, planId, topupPaise } = notes;
      if (!uid || !kind) {
        console.error('Payment missing required notes:', notes);
        return res.status(200).json({ received: true, skipped: true, reason: 'missing notes on payment' });
      }

      const paymentId = verifiedPayment.id;
      const processedRef = db.doc('processedPayments/' + paymentId);
      const processedSnap = await processedRef.get();
      if (processedSnap.exists) {
        return res.status(200).json({ received: true, skipped: true, reason: 'already processed' });
      }

      if (kind === 'plan') {
        const ok = await grantPlan(db, uid, planId);
        if (!ok) {
          console.error('Invalid planId on payment notes:', planId);
          return res.status(200).json({ received: true, skipped: true, reason: 'invalid planId' });
        }
      } else if (kind === 'topup') {
        const grantAmount = TOPUP_AMOUNTS[parseInt(topupPaise, 10)];
        if (!grantAmount) {
          console.error('Invalid topupPaise on payment notes:', topupPaise);
          return res.status(200).json({ received: true, skipped: true, reason: 'invalid topup amount' });
        }
        const userRef = db.doc('users/' + uid);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentCash = typeof userData.cash === 'number' ? userData.cash : PLAN_START.trial;
        const currentCapitalIn = typeof userData.totalCapitalIn === 'number' ? userData.totalCapitalIn : currentCash;
        await userRef.set({ cash: currentCash + grantAmount, totalCapitalIn: currentCapitalIn + grantAmount }, { merge: true });
      } else {
        return res.status(200).json({ received: true, skipped: true, reason: 'unknown kind: ' + kind });
      }

      await processedRef.set({ uid, kind, processedAt: now });
      return res.status(200).json({ received: true, success: true });
    }

    // ===== Path 2: true recurring Subscriptions (Basic/Growth/Pro auto-renew) =====
    if (event && event.event === 'subscription.charged') {
      const subscriptionIdFromWebhook = event.payload?.subscription?.entity?.id;
      const paymentIdFromWebhook = event.payload?.payment?.entity?.id;
      if (!subscriptionIdFromWebhook || !paymentIdFromWebhook) {
        return res.status(200).json({ received: true, skipped: true, reason: 'missing subscription/payment id' });
      }

      // Independently verify both — notes live on the subscription, but we
      // also confirm the payment itself genuinely captured before granting.
      const verifiedSubscription = await fetchSubscription(subscriptionIdFromWebhook);
      const verifiedPayment = await fetchPayment(paymentIdFromWebhook);
      if (verifiedPayment.status !== 'captured') {
        return res.status(200).json({ received: true, skipped: true, reason: 'payment not captured: ' + verifiedPayment.status });
      }

      const notes = verifiedSubscription.notes || {};
      const { uid, planId } = notes;
      if (!uid || !planId) {
        console.error('Subscription missing required notes:', notes);
        return res.status(200).json({ received: true, skipped: true, reason: 'missing notes on subscription' });
      }

      const paymentId = verifiedPayment.id;
      const processedRef = db.doc('processedPayments/' + paymentId);
      const processedSnap = await processedRef.get();
      if (processedSnap.exists) {
        return res.status(200).json({ received: true, skipped: true, reason: 'already processed' });
      }

      const ok = await grantPlan(db, uid, planId, { razorpaySubscriptionId: subscriptionIdFromWebhook });
      if (!ok) {
        console.error('Invalid planId on subscription notes:', planId);
        return res.status(200).json({ received: true, skipped: true, reason: 'invalid planId' });
      }

      await processedRef.set({ uid, kind: 'subscription', subscriptionId: subscriptionIdFromWebhook, processedAt: now });
      return res.status(200).json({ received: true, success: true });
    }

    // Any other event (subscription.activated, .cancelled, .halted, etc.)
    // — acknowledged but no action needed; our existing 30-day expiry
    // logic naturally handles "stopped renewing" without special-casing.
    return res.status(200).json({ received: true, skipped: true, reason: 'unhandled event: ' + (event && event.event) });
  } catch (err) {
    console.error('razorpay-webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
