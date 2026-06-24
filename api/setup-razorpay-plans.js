// api/setup-razorpay-plans.js
//
// ONE-TIME SETUP — visit this URL once (in Test Mode first, then again
// after switching to Live keys, since Test and Live plans are separate):
//   https://trade.scaleaiq.in/api/setup-razorpay-plans
//
// Creates the 3 recurring billing Plans on Razorpay (Basic/Growth/Pro)
// and saves their plan_ids to Firestore so api/create-subscription.js
// can look them up. Safe to re-run — it always overwrites with fresh IDs
// if you ever need to (e.g. switching Test -> Live).

const { getDb } = require('../lib/firebase-admin');
const { createPlan } = require('../lib/razorpay');

const PLANS_TO_CREATE = {
  basic:  { amountPaise: 14900, name: 'TradeSeekho Basic — Monthly' },
  growth: { amountPaise: 29900, name: 'TradeSeekho Growth — Monthly' },
  pro:    { amountPaise: 59900, name: 'TradeSeekho Pro — Monthly' }
};

module.exports = async function handler(req, res) {
  try {
    const result = {};
    for (const [key, cfg] of Object.entries(PLANS_TO_CREATE)) {
      const plan = await createPlan({
        amountPaise: cfg.amountPaise,
        name: cfg.name,
        period: 'monthly',
        interval: 1
      });
      result[key] = plan.id;
    }

    const db = getDb();
    await db.doc('system/razorpayPlans').set({ ...result, createdAt: Date.now() });

    res.status(200).json({
      success: true,
      plans: result,
      message: 'All 3 Razorpay Plans created and saved. Subscriptions are ready to use.'
    });
  } catch (err) {
    console.error('setup-razorpay-plans error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
