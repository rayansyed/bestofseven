// POST /api/sell — sells player cards for coins: { ids: [cardDocId, ...] }.
// Refuses to sell the last copy of a player who's in a lineup for today or later.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { SELL_VALUE } = require('./_packs.js');

function admin() {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return { auth: getAuth(), db: getFirestore() };
}

const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date()).replace(/-/g, '');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new HttpError(500, 'The server is missing FIREBASE_SERVICE_ACCOUNT. See README step 8.');
    const ids = [...new Set((req.body && req.body.ids) || [])].filter(id => typeof id === 'string' && /^[A-Za-z0-9]{1,40}$/.test(id));
    if (!ids.length || ids.length > 100) throw new HttpError(400, 'Choose up to 100 cards to sell.');
    const { auth, db } = admin();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Sign in first.');
    const { uid } = await auth.verifyIdToken(token);

    const userRef = db.doc('users/' + uid), cardsRef = db.collection(`users/${uid}/cards`);
    const out = await db.runTransaction(async tx => {
      const [user, all, upcoming] = await Promise.all([tx.get(userRef), tx.get(cardsRef), tx.get(db.collection('entries').where('uid', '==', uid))]);
      if (!user.exists) throw new HttpError(400, 'Pick a display name first.');
      const mine = new Map(all.docs.map(d => [d.id, d.data()]));
      const selling = ids.map(id => { const c = mine.get(id); if (!c) throw new HttpError(404, 'One of those cards isn’t yours any more.'); return [id, c]; });
      // Players in a lineup for today or later must keep at least one card.
      const today = etDay(), inLineup = new Set(upcoming.docs.map(d => d.data()).filter(e => e.date >= today).flatMap(e => e.ids || []));
      const left = new Map();
      for (const c of mine.values()) left.set(c.pid, (left.get(c.pid) || 0) + 1);
      for (const [, c] of selling) left.set(c.pid, left.get(c.pid) - 1);
      const stuck = selling.find(([, c]) => left.get(c.pid) < 1 && inLineup.has(c.pid));
      if (stuck) throw new HttpError(409, `${stuck[1].name} is in one of your lineups. Take him out first, or keep one card.`);
      const coins = selling.reduce((s, [, c]) => s + (SELL_VALUE[c.rarity] || SELL_VALUE.common), 0);
      for (const [id] of selling) tx.delete(cardsRef.doc(id));
      const balance = (user.data().coins || 0) + coins;
      tx.update(userRef, { coins: balance });
      return { sold: selling.length, coins, balance };
    });
    res.status(200).json(out);
  } catch (err) {
    const status = err.status || (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired' ? 401 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong selling those cards. Try again.' : err.message });
  }
};
