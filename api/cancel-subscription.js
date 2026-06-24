// api/cancel-subscription.js
//
// Cancels a user's active Razorpay subscription — called when they
// downgrade to a lower plan, so they stop being auto-charged at their
// OLD (higher) plan's rate. Downgrading itself stays free/instant (per
// app logic in plans.html); this just stops the underlying recurring
// billing relationship for the plan they're leaving.

const { getDb } = require('../lib/firebase-admin');
const { cancelSubscription } = require('../lib/razorpay');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ success: false, error: 'Missing uid' });

    const db = getDb();
    const userRef = db.doc('users/' + uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const subscriptionId = userData.razorpaySubscriptionId;

    if (!subscriptionId) {
      // No active subscription to cancel (e.g. they paid via one-time
      // order, not true auto-billing) — nothing to do, not an error.
      return res.status(200).json({ success: true, cancelled: false, reason: 'no active subscription on file' });
    }

    await cancelSubscription(subscriptionId);
    await userRef.set({ razorpaySubscriptionId: null }, { merge: true });

    res.status(200).json({ success: true, cancelled: true });
  } catch (err) {
    console.error('cancel-subscription error:', err);
    // Don't block the downgrade itself on this failing — log it, but let
    // the user's plan change proceed; worth a manual follow-up if it errors.
    res.status(200).json({ success: false, error: err.message });
  }
};
