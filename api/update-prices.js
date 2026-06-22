// api/update-prices.js
//
// This is the endpoint client pages poll every 5 seconds. It does NOT
// call Angel One on every single request — it checks Firestore first to
// see if 5 seconds have actually passed since the last real fetch. If
// not, it just returns immediately (no-op). This means no matter how
// many users have the app open at once, Angel One only gets called
// roughly once every 5 seconds, total — not once per user.

const { getDb } = require('../lib/firebase-admin');
const { fetchQuotes, INDEX_TOKENS } = require('../lib/angelone');

const THROTTLE_MS = 5000;
const LIVE_PRICES_DOC = 'livePrices/current';

module.exports = async function handler(req, res) {
  try {
    const force = req.query && req.query.force === 'true';

    const db = getDb();
    const liveRef = db.doc(LIVE_PRICES_DOC);
    const liveSnap = await liveRef.get();
    const existing = liveSnap.exists ? liveSnap.data() : null;

    const now = Date.now();
    if (!force && existing && existing.fetchedAt && (now - existing.fetchedAt) < THROTTLE_MS) {
      // Too soon — someone else's poll already refreshed this recently.
      return res.status(200).json({ success: true, skipped: true, ageMs: now - existing.fetchedAt });
    }

    // Check if market hours (rough check; doesn't account for holidays —
    // that's a fine-tune for later, not a blocker for launch)
    const ist = new Date(now + (5.5 * 60 * 60 * 1000));
    const day = ist.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const hour = ist.getUTCHours();
    const minute = ist.getUTCMinutes();
    const isWeekday = day >= 1 && day <= 5;
    const afterOpen = hour > 9 || (hour === 9 && minute >= 15);
    const beforeClose = hour < 15 || (hour === 15 && minute <= 30);
    const marketOpen = isWeekday && afterOpen && beforeClose;

    if (!force && !marketOpen && existing) {
      // Market closed and we already have last-known prices cached —
      // no need to call Angel One, just confirm we're serving stale-but-fine data.
      return res.status(200).json({ success: true, marketOpen: false, usingLastKnown: true });
    }

    // Get cached symbol -> token mapping (built once via /api/setup-tokens)
    const tokenSnap = await db.doc('system/symbolTokens').get();
    if (!tokenSnap.exists) {
      return res.status(400).json({
        success: false,
        error: 'No symbol tokens found. Visit /api/setup-tokens once first to set this up.'
      });
    }
    const tokenMap = tokenSnap.data().tokens || {};
    const symbols = Object.keys(tokenMap);
    const stockTokens = symbols.map(s => tokenMap[s]);

    if (stockTokens.length === 0) {
      return res.status(400).json({ success: false, error: 'Symbol token list is empty.' });
    }

    // Build a clean prices object keyed by our symbol names
    const tokenToSymbol = {};
    Object.keys(tokenMap).forEach(sym => { tokenToSymbol[tokenMap[sym]] = sym; });

    const prices = {};
    const indices = {};
    const debug = {};

    // Fetch 50 stocks (NSE only) — separate call from indices so one
    // failing doesn't silently take down the other.
    try {
      const stockData = await fetchQuotes({ NSE: stockTokens });
      (stockData.fetched || []).forEach(item => {
        const sym = tokenToSymbol[item.symbolToken];
        if (!sym) return;
        prices[sym] = {
          ltp: item.ltp, open: item.open, high: item.high, low: item.low,
          close: item.close, volume: item.tradeVolume || 0
        };
      });
      debug.stocksFetched = (stockData.fetched || []).length;
      debug.stocksUnfetched = stockData.unfetched || [];
    } catch (e) {
      debug.stocksError = e.message;
    }

    // Fetch indices separately — Nifty on NSE, Sensex on BSE
    try {
      const idxData = await fetchQuotes({
        NSE: [INDEX_TOKENS.NIFTY.token],
        BSE: [INDEX_TOKENS.SENSEX.token]
      });
      debug.indexFetched = idxData.fetched || [];
      debug.indexUnfetched = idxData.unfetched || [];
      (idxData.fetched || []).forEach(item => {
        if (item.symbolToken === INDEX_TOKENS.NIFTY.token) {
          indices.NIFTY = { ltp: item.ltp, close: item.close, open: item.open, high: item.high, low: item.low };
        } else if (item.symbolToken === INDEX_TOKENS.SENSEX.token) {
          indices.SENSEX = { ltp: item.ltp, close: item.close, open: item.open, high: item.high, low: item.low };
        }
      });
    } catch (e) {
      debug.indexError = e.message;
    }

    await liveRef.set({
      prices,
      indices,
      marketOpen: true,
      fetchedAt: now
    });

    res.status(200).json({ success: true, count: Object.keys(prices).length, indices, marketOpen, forced: force, debug });
  } catch (err) {
    console.error('update-prices error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
