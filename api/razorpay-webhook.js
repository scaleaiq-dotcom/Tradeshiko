// api/razorpay-webhook.js
//
// Receives Razorpay's payment.captured webhook and automatically grants
// the matching plan/top-up — same logic as applyPlanUpgrade() in the app,
// run server-side so it works even if the user's browser is closed.
//
// VERIFICATION STRATEGY — why this isn't a simple HMAC-on-raw-body check:
// Vercel's plain serverless functions (this codebase doesn't use Next.js)
// have inconsistent/unclear documented behavior around raw request body
// access, which raw-body HMAC verification depends on getting exactly
// right. Rather than risk a subtly-broken signature check, we use the
// payment_id from the webhook purely as a REFERENCE, then independently
// ask Razorpay's own API "is this payment really captured, and what are
// its real notes?" An attacker can send us a fake webhook body, but they
// cannot fake what Razorpay's servers say about a real payment_id — so
// this is resistant to spoofing without depending on raw-body quirks.

const { getDb } = require('../lib/firebase-admin');
const { fetchPayment } = require('../lib/razorpay');

const PLAN_START = { trial: 2000000, basic: 500000, growth: 1000000, pro: 2000000 };
const VALID_PLANS = ['trial', 'basic', 'growth', 'pro'];
const ADMIN_EMAILS = ['scaleaiq@gmail.com', 'jitendramathur.85@gmail.com'];
const TOPUP_AMOUNTS = { 2900: 100000, 4900: 250000, 9900: 500000, 19900: 1000000, 34900: 2000000 };

module.exports = async function handler(req, res){
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const event = req.body; // Vercel auto-parses JSON for plain serverless functions
    if (!event || event.event !== 'payment.captured') {
      return res.status(200).json({ received: true, skipped: true, reason: 'not a payment.captured event' });
    }

    const paymentIdFromWebhook = event.payload?.payment?.entity?.id;
    if (!paymentIdFromWebhook) {
      return res.status(200).json({ received: true, skipped: true, reason: 'no payment id in webhook' });
    }

    // Real trust boundary: independently verify with Razorpay's own API
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

    const db = getDb();
    const paymentId = verifiedPayment.id;

    // Idempotency — Razorpay may send the same webhook more than once.
    // Never grant the same payment twice.
    const processedRef = db.doc('processedPayments/' + paymentId);
    const processedSnap = await processedRef.get();
    if (processedSnap.exists) {
      return res.status(200).json({ received: true, skipped: true, reason: 'already processed' });
    }

    const userRef = db.doc('users/' + uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const currentPlan = VALID_PLANS.includes(userData.plan) ? userData.plan : 'trial';
    const currentCash = typeof userData.cash === 'number' ? userData.cash : PLAN_START.trial;
    const now = Date.now();

    if (kind === 'plan') {
      if (!PLAN_START.hasOwnProperty(planId) || planId === 'trial') {
        console.error('Invalid planId on payment notes:', planId);
        return res.status(200).json({ received: true, skipped: true, reason: 'invalid planId' });
      }
      // Same fresh-start / add-the-difference logic as applyPlanUpgrade() client-side
      let newCash;
      if (currentPlan === 'trial') {
        newCash = PLAN_START[planId]; // trial -> paid: fresh start at the new plan's capital
      } else {
        const diff = PLAN_START[planId] - PLAN_START[currentPlan];
        newCash = currentCash + Math.max(diff, 0); // upgrade adds the difference; same-plan renewal adds 0
      }
      await userRef.set({
        plan: planId,
        cash: newCash,
        planStartDate: now,
        lastTopupDate: now,
        dailyTradeDate: null,
        dailyTradeCount: 0
      }, { merge: true });

      // Mirror to leaderboard — respecting the same admin-exclusion rule used client-side
      const myEmail = (userData.email || '').toLowerCase();
      if (!ADMIN_EMAILS.includes(myEmail)) {
        await db.doc('leaderboard/' + uid).set({
          displayName: userData.displayName || 'Trader',
          photoURL: userData.photoURL || '',
          peakValue: userData.peakValue || newCash,
          plan: planId,
          updatedAt: now
        }, { merge: true });
      }
    } else if (kind === 'topup') {
      const grantAmount = TOPUP_AMOUNTS[parseInt(topupPaise, 10)];
      if (!grantAmount) {
        console.error('Invalid topupPaise on payment notes:', topupPaise);
        return res.status(200).json({ received: true, skipped: true, reason: 'invalid topup amount' });
      }
      await userRef.set({ cash: currentCash + grantAmount }, { merge: true });
    } else {
      return res.status(200).json({ received: true, skipped: true, reason: 'unknown kind: ' + kind });
    }

    // Mark processed — guards against double-processing on webhook retries
    await processedRef.set({ uid, kind, processedAt: now });

    res.status(200).json({ received: true, success: true });
  } catch (err) {
    console.error('razorpay-webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
