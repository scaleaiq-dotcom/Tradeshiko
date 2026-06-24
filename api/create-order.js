// api/create-order.js
//
// Creates a Razorpay order for either a plan purchase (basic/growth/pro)
// or a top-up purchase. The client sends WHAT it wants (an id), never an
// amount — the real price is always looked up server-side, so nothing
// can be tampered with by editing client-side code.

const { createOrder, PLAN_PRICES_PAISE, TOPUP_PRICES_PAISE } = require('../lib/razorpay');

module.exports = async function handler(req, res){
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const { uid, kind, id } = req.body || {};
    if (!uid || !kind || !id) {
      return res.status(400).json({ success: false, error: 'Missing uid, kind, or id' });
    }

    let amountPaise, notes;

    if (kind === 'plan') {
      amountPaise = PLAN_PRICES_PAISE[id];
      if (!amountPaise) return res.status(400).json({ success: false, error: 'Invalid plan id: ' + id });
      notes = { uid, kind: 'plan', planId: id };
    } else if (kind === 'topup') {
      const paise = parseInt(id, 10);
      if (!TOPUP_PRICES_PAISE[paise]) return res.status(400).json({ success: false, error: 'Invalid topup id: ' + id });
      amountPaise = paise;
      notes = { uid, kind: 'topup', topupPaise: String(paise) };
    } else {
      return res.status(400).json({ success: false, error: 'Invalid kind: ' + kind });
    }

    const receipt = 'rcpt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const order = await createOrder({ amountPaise, receipt, notes });

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
