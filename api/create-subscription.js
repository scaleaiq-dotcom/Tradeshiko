// api/create-subscription.js
//
// Creates a real Razorpay Subscription for a user upgrading to Basic,
// Growth, or Pro — this is what makes renewal fully automatic (UPI
// AutoPay or saved card), unlike the one-time Orders used for top-ups.
//
// The Razorpay plan_id for each tier must already exist — see
// api/setup-razorpay-plans.js (run once before this can work).

const { getDb } = require('../lib/firebase-admin');
const { createSubscription } = require('../lib/razorpay');

const VALID_PLANS = ['basic', 'growth', 'pro'];
// 12 months of auto-renewal. Razorpay's checkout shows the resulting end
// date upfront as a transparency disclosure (e.g. "will charge until
// [date]") — a 10-year total_count made this read as "until 2036", which
// felt like a decade-long lock-in even though cancellation is fully
// supported at any time. 12 cycles keeps that disclosure date looking
// completely normal (~1 year out). When it naturally completes, the
// existing 30-day manual-renewal flow takes over automatically — no
// extra logic needed, the user just renews the same way as before.
const TOTAL_BILLING_CYCLES = 12;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const { uid, planId } = req.body || {};
    if (!uid || !planId) {
      return res.status(400).json({ success: false, error: 'Missing uid or planId' });
    }
    if (!VALID_PLANS.includes(planId)) {
      return res.status(400).json({ success: false, error: 'Invalid planId: ' + planId });
    }

    const db = getDb();
    const plansSnap = await db.doc('system/razorpayPlans').get();
    if (!plansSnap.exists) {
      return res.status(500).json({
        success: false,
        error: 'Razorpay plans not set up yet — visit /api/setup-razorpay-plans once first.'
      });
    }
    const razorpayPlanId = plansSnap.data()[planId];
    if (!razorpayPlanId) {
      return res.status(500).json({ success: false, error: 'No Razorpay plan_id found for ' + planId });
    }

    const subscription = await createSubscription({
      planId: razorpayPlanId,
      totalCount: TOTAL_BILLING_CYCLES,
      notes: { uid, planId, kind: 'subscription' }
    });

    res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('create-subscription error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
