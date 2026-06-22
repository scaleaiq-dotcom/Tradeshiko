// lib/firebase-admin.js
// Initializes Firebase Admin SDK once, using the service account JSON
// stored in the FIREBASE_SERVICE_ACCOUNT Vercel environment variable.
// Admin SDK access bypasses Firestore security rules entirely — this
// is intentional, since this server-side code is the only thing allowed
// to write to the shared /livePrices collection.

const admin = require('firebase-admin');

let app;

function getAdminApp() {
  if (app) return app;

  if (admin.apps.length > 0) {
    app = admin.apps[0];
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set in Vercel.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Make sure you pasted the entire downloaded file contents.');
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return app;
}

function getDb() {
  return getAdminApp().firestore();
}

module.exports = { getAdminApp, getDb };
