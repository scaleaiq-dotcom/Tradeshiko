// api/setup-tokens.js
//
// ONE-TIME SETUP — visit this URL once after deploying:
//   https://trade.scaleaiq.in/api/setup-tokens
//
// This downloads Angel One's full instrument master list, finds the
// "token" (their internal instrument ID) for each of our 50 stocks, and
// saves the symbol -> token mapping to Firestore so the recurring price
// fetcher (update-prices.js) doesn't have to re-download that large file
// every time.
//
// Safe to re-run any time (e.g. if you add new stocks to the list below).

const { getDb } = require('../lib/firebase-admin');
const { resolveSymbolTokens } = require('../lib/angelone');

// Master 50-stock list — keep this in sync with the same list in index.html
const ALL_STOCKS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","SBIN","TATAMOTORS","ITC","BHARTIARTL","WIPRO",
  "KOTAKBANK","BAJFINANCE","AXISBANK","HCLTECH","TECHM","ONGC","NTPC","POWERGRID","MARUTI","M&M",
  "LT","TATASTEEL","HINDUNILVR","NESTLEIND","BRITANNIA","ASIANPAINT","SUNPHARMA","DRREDDY","CIPLA","ADANIPORTS",
  "BAJAJFINSV","INDUSINDBK","HDFCLIFE","SBILIFE","TITAN","ULTRACEMCO","GRASIM","JSWSTEEL","HINDALCO","COALINDIA",
  "BPCL","IOC","ADANIENT","DIVISLAB","APOLLOHOSP","EICHERMOT","HEROMOTOCO","TATACONSUM","LTIM","PIDILITIND"
];

module.exports = async function handler(req, res) {
  try {
    const tokenMap = await resolveSymbolTokens(ALL_STOCKS);

    const found = Object.keys(tokenMap);
    const missing = ALL_STOCKS.filter(s => !found.includes(s));

    const db = getDb();
    await db.doc('system/symbolTokens').set({
      tokens: tokenMap,
      updatedAt: Date.now()
    });

    res.status(200).json({
      success: true,
      foundCount: found.length,
      totalExpected: ALL_STOCKS.length,
      missing: missing, // if any symbols weren't found, check spelling/NSE listing
      message: missing.length > 0
        ? 'Done, but some symbols were not found — check the "missing" list above for typos or delisted/renamed stocks.'
        : 'All 50 symbols resolved and cached successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
