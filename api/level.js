// POST /api/level — levels up a player's card: { pid, stat }. Uses up LEVEL.cost duplicate copies of that player
// and adds LEVEL.bonus to the chosen category, up to LEVEL.max. Done here so nobody can level a card from the browser.
// Levels belong to the player's best copy (rarest, then highest level). If a rarer copy has turned up since the
// last level-up, the levels move onto it.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { LEVEL, RANK } = require('./_packs.js');

function admin() {
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return { auth: getAuth(), db: getFirestore() };
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// The copy that plays (rarest, then highest level) and the copy carrying the player's levels.
function keeperAndLevels(copies) {
  const r = c => RANK[c.rarity] ?? 0, lv = c => c.level || 1;
  const keeper = copies.reduce((a, b) => r(b) > r(a) || (r(b) === r(a) && lv(b) > lv(a)) ? b : a);
  const src = copies.reduce((a, b) => lv(b) > lv(a) ? b : a, keeper);
  return { keeper, src };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new HttpError(500, 'The server is missing FIREBASE_SERVICE_ACCOUNT. See README step 8.');
    const pid = String((req.body && req.body.pid) || ''), stat = String((req.body && req.body.stat) || '');
    if (!/^[A-Za-z0-9-]{1,24}$/.test(pid)) throw new HttpError(400, 'Choose a player.');
    if (!LEVEL.stats.includes(stat)) throw new HttpError(400, 'Choose a category to boost.');
    const { auth, db } = admin();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Sign in first.');
    const { uid } = await auth.verifyIdToken(token);

    const cardsRef = db.collection(`users/${uid}/cards`);
    const out = await db.runTransaction(async tx => {
      const snap = await tx.get(cardsRef.where('pid', '==', pid));
      const copies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!copies.length) throw new HttpError(404, 'You don’t have a card of him.');
      const { keeper, src } = keeperAndLevels(copies);
      const level = src.level || 1;
      if (level >= LEVEL.max) throw new HttpError(409, `${keeper.name || 'He'} is already at Level ${LEVEL.max}, the top level.`);
      // Spend the plainest copies first; a lower copy that carried the levels goes last.
      const spares = copies.filter(c => c.id !== keeper.id)
        .sort((a, b) => (a.id === src.id) - (b.id === src.id) || (RANK[a.rarity] ?? 0) - (RANK[b.rarity] ?? 0));
      if (spares.length < LEVEL.cost) throw new HttpError(409, `Level ${level + 1} needs ${LEVEL.cost} duplicates of him. You have ${spares.length}.`);
      const used = spares.slice(0, LEVEL.cost), picks = [...(src.picks || []), stat];
      tx.update(cardsRef.doc(keeper.id), { level: level + 1, picks, leveledAt: Date.now() });
      for (const c of used) tx.delete(cardsRef.doc(c.id));
      if (src.id !== keeper.id && !used.some(c => c.id === src.id)) tx.update(cardsRef.doc(src.id), { level: FieldValue.delete(), picks: FieldValue.delete() });
      return { level: level + 1, picks, used: used.length, name: keeper.name || '' };
    });
    res.status(200).json(out);
  } catch (err) {
    const status = err.status || (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired' ? 401 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong levelling up that card. Try again.' : err.message });
  }
};
