// POST /api/packs — opens one of a player's free starter packs.
// Cards are created here, on the server, so nobody can hand themselves cards from the browser.
// Needs the FIREBASE_SERVICE_ACCOUNT environment variable in Vercel (the same JSON as the GitHub secret).
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { makeStarterPack, STARTER_PACKS } = require('./_packs.js');

function admin() {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return { auth: getAuth(), db: getFirestore() };
}

const etDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + offset * 864e5)).replace(/-/g, '');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new HttpError(500, 'The server is missing FIREBASE_SERVICE_ACCOUNT. See README step 8.');
    const { auth, db } = admin();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Sign in first.');
    const { uid } = await auth.verifyIdToken(token);

    const userRef = db.doc('users/' + uid), cardsRef = db.collection(`users/${uid}/cards`);
    const cards = await db.runTransaction(async tx => {
      const user = await tx.get(userRef);
      if (!user.exists) throw new HttpError(400, 'Pick a display name first.');
      const opened = user.data().starterPacks || 0;
      if (opened >= STARTER_PACKS) throw new HttpError(409, 'You’ve opened all your starter packs.');
      const [owned, roster, ...days] = await Promise.all([tx.get(cardsRef), tx.get(db.doc('meta/roster')), tx.get(db.doc('days/' + etDay(0))), tx.get(db.doc('days/' + etDay(1)))]);
      if (!roster.exists) throw new HttpError(503, 'Cards aren’t ready yet. Try again after the next sync.');
      const upcomingTeams = new Set(days.filter(d => d.exists).flatMap(d => (d.data().games || []).flatMap(g => [g.away, g.home])));
      const pack = makeStarterPack({ roster: roster.data().players, owned: new Set(owned.docs.map(d => d.data().pid)), packNo: opened, upcomingTeams });
      const at = Date.now();
      for (const c of pack) tx.set(cardsRef.doc(), { ...c, at });
      tx.update(userRef, { starterPacks: opened + 1 });
      return pack;
    });
    res.status(200).json({ cards });
  } catch (err) {
    const status = err.status || (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired' ? 401 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong opening the pack. Try again.' : err.message });
  }
};
