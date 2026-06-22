// lib/angelone.js
// Handles everything needed to talk to Angel One SmartAPI:
//  1. Generate a TOTP code from the secret (RFC 6238, hand-rolled — no extra npm package needed)
//  2. Log in (cached in Firestore so we don't re-login on every 5-second tick —
//     Angel One sessions are valid until midnight, so we reuse the same
//     jwtToken across calls and only re-login when it's missing/stale)
//  3. Fetch live quotes for up to 50 NSE symbols in a single request
//
// NOTE: Angel One's exact API behavior can occasionally change or have
// undocumented quirks (e.g. specific header requirements). This is built
// against their documented pattern as of integration time — if a call
// fails, check the error message/response logged in Vercel's function logs
// first; it usually tells you exactly what's wrong (bad TOTP, expired
// session, invalid token, etc.)

const crypto = require('crypto');
const { getDb } = require('./firebase-admin');

const BASE_URL = 'https://apiconnect.angelone.in';
const SESSION_DOC = 'system/angelSession'; // collection/doc path for cached session

// ---------- TOTP generation (RFC 6238) ----------
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32.replace(/=+$/, '').toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret) {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const timeCounter = Math.floor(epoch / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(timeCounter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

// ---------- Standard headers Angel One expects on every call ----------
function buildHeaders(jwtToken) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '106.193.147.98',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY
  };
  if (jwtToken) h['Authorization'] = 'Bearer ' + jwtToken;
  return h;
}

// ---------- Login (cached) ----------
async function getSession() {
  const db = getDb();
  const sessionRef = db.doc(SESSION_DOC);
  const snap = await sessionRef.get();
  const cached = snap.exists ? snap.data() : null;

  // Reuse cached session if it's from today (Angel One sessions are valid until midnight IST)
  if (cached && cached.jwtToken && cached.loggedInDate === todayIST()) {
    return cached.jwtToken;
  }

  // Otherwise, log in fresh
  const totp = generateTOTP(process.env.ANGEL_TOTP_SECRET);
  const resp = await fetch(BASE_URL + '/rest/auth/angelbroking/user/v1/loginByPassword', {
    method: 'POST',
    headers: buildHeaders(null),
    body: JSON.stringify({
      clientcode: process.env.ANGEL_CLIENT_CODE,
      password: process.env.ANGEL_MPIN,
      totp: totp
    })
  });
  const json = await resp.json();

  if (!json.status || !json.data || !json.data.jwtToken) {
    throw new Error('Angel One login failed: ' + (json.message || JSON.stringify(json)));
  }

  await sessionRef.set({
    jwtToken: json.data.jwtToken,
    refreshToken: json.data.refreshToken || null,
    feedToken: json.data.feedToken || null,
    loggedInDate: todayIST(),
    loggedInAt: Date.now()
  });

  return json.data.jwtToken;
}

function todayIST() {
  // Simple date key (YYYY-MM-DD) in IST, used to decide if cached session is "today's"
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

// ---------- Fetch quotes for tokens across one or more exchanges ----------
// exchangeTokens example: { NSE: ["2885", "99926000"], BSE: ["99919000"] }
async function fetchQuotes(exchangeTokens) {
  const jwtToken = await getSession();
  const resp = await fetch(BASE_URL + '/rest/secure/angelbroking/market/v1/quote/', {
    method: 'POST',
    headers: buildHeaders(jwtToken),
    body: JSON.stringify({
      mode: 'FULL',
      exchangeTokens: exchangeTokens
    })
  });
  const json = await resp.json();
  if (!json.status) {
    throw new Error('Angel One quote fetch failed: ' + (json.message || JSON.stringify(json)));
  }
  return json.data; // { fetched: [...], unfetched: [...] }
}

// Known index tokens (NOT in the regular instrument master file — Angel One
// documented these separately since indices aren't "tradable" instruments).
// NIFTY 50: NSE, token 99926000. SENSEX: BSE, token 99919000.
const INDEX_TOKENS = {
  NIFTY: { exchange: 'NSE', token: '99926000' },
  SENSEX: { exchange: 'BSE', token: '99919000' }
};

// ---------- One-time: fetch the full instrument master and find tokens for our symbols ----------
async function resolveSymbolTokens(symbols) {
  const resp = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  if (!resp.ok) throw new Error('Could not download Angel One instrument master file (status ' + resp.status + ')');
  const all = await resp.json();

  const wanted = new Set(symbols.map(s => (s + '-EQ').toUpperCase()));
  const found = {};
  for (const item of all) {
    if (item.exch_seg === 'NSE' && wanted.has((item.symbol || '').toUpperCase())) {
      const baseSymbol = item.symbol.replace(/-EQ$/i, '');
      found[baseSymbol] = item.token;
    }
  }
  return found; // { RELIANCE: "2885", TCS: "11536", ... }
}

module.exports = { generateTOTP, getSession, fetchQuotes, resolveSymbolTokens, INDEX_TOKENS };
