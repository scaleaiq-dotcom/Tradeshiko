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
// ~10 years of monthly billing cycles — effectively indefinite in
// practice; the user can cancel anytime via Razorpay's cancellation flow.
const TOTAL_BILLING_CYCLES = 120;

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
