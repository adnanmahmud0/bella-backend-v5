import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// You need to set FIREBASE_SERVICE_ACCOUNT environment variable with the path to your service account key file
// OR set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY environment variables

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // If service account file path is provided
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized with service account file');
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    // If credentials are provided via env vars
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Firebase Admin initialized with environment variables');
  } else {
    console.warn('Firebase Admin NOT initialized: Missing credentials');
  }
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
}

export const messaging = admin.apps.length ? admin.messaging() : null;
