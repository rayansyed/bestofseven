// POST /api/packs — opens a pack: { type: 'starter' | 'daily' | 'standard' | 'premium', gift?: true } (starter if
// omitted). gift opens one of the player's gifted packs instead of paying coins.
// Cards are created here, on the server, so nobody can hand themselves cards or coins from the browser.
// Needs the FIREBASE_SERVICE_ACCOUNT environment variable in Vercel (the same JSON as the GitHub secret).
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { makeStarterPack, STARTER_PACKS, PACKS, makePack, openSlateTeams, specialsFor } = require('./_packs.js');

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
    const type = (req.body && req.body.type) || 'starter', gift = !!(req.body && req.body.gift) && type !== 'starter';
    if (type !== 'starter' && !PACKS[type]) throw new HttpError(400, 'Unknown pack.');
    const { auth, db } = admin();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Sign in first.');
    const { uid } = await auth.verifyIdToken(token);

    const userRef = db.doc('users/' + uid), cardsRef = db.collection(`users/${uid}/cards`), boostersRef = db.collection(`users/${uid}/boosters`);
    const today = etDay();
    const out = await db.runTransaction(async tx => {
      const user = await tx.get(userRef);
      if (!user.exists) throw new HttpError(400, 'Pick a display name first.');
      const u = user.data(), opened = u.starterPacks || 0;
      const [roster, ...days] = await Promise.all([tx.get(db.doc('meta/roster')), tx.get(db.doc('days/' + etDay(0))), tx.get(db.doc('days/' + etDay(1))), tx.get(db.doc('days/' + etDay(2)))]);
      if (!roster.exists) throw new HttpError(503, 'Cards aren’t ready yet. Try again after the next sync.');
      const open = openSlateTeams(days.map(d => d.exists ? d.data() : null));
      let pack, update;
      if (type === 'starter') {
        if (opened >= STARTER_PACKS) throw new HttpError(409, 'You’ve opened all your starter packs.');
        const owned = await tx.get(cardsRef);
        const upcomingTeams = new Set(open.slice(0, 2).flatMap(t => [...t]));
        pack = { cards: makeStarterPack({ roster: roster.data().players, owned: new Set(owned.docs.map(d => d.data().pid)), packNo: opened, upcomingTeams }), boosters: [] };
        update = { starterPacks: opened + 1 };
      } else {
        const def = PACKS[type], coins = u.coins || 0, gifts = (u.giftPacks || {})[type] || 0;
        if (opened < STARTER_PACKS) throw new HttpError(409, 'Open your starter packs first.');
        // A gifted pack (giftPacks.<type> on the user, set by hand in the Firebase console) is free and
        // doesn't count as the day's daily pack.
        if (gift && gifts < 1) throw new HttpError(409, `You don’t have a gifted ${def.name}.`);
        if (!gift && type === 'daily' && u.dailyPack === today) throw new HttpError(409, 'You’ve opened today’s free pack. A new one comes tomorrow.');
        if (!gift && coins < def.price) throw new HttpError(409, `You need ${def.price - coins} more coins for a ${def.name}.`);
        // The daily pack's players have a game on the next slate that's still open.
        // Special cards running this week (Weekly Stars and any later programs) can take the last player's place.
        const r = roster.data();
        pack = makePack({ roster: r.players, kind: type, teams: type === 'daily' ? open[0] || null : null, specials: specialsFor(r, today) });
        update = gift ? { [`giftPacks.${type}`]: gifts - 1 } : type === 'daily' ? { dailyPack: today } : { coins: coins - def.price };
      }
      const at = Date.now();
      const cards = pack.cards.map(c => { const ref = cardsRef.doc(); tx.set(ref, { ...c, at }); return { id: ref.id, ...c }; });
      const boosters = pack.boosters.map(b => { const ref = boostersRef.doc(); tx.set(ref, { ...b, at }); return { id: ref.id, ...b }; });
      tx.update(userRef, update);
      return { cards, boosters };
    });
    res.status(200).json(out);
  } catch (err) {
    const status = err.status || (err.code === 'auth/argument-error' || err.code === 'auth/id-token-expired' ? 401 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong opening the pack. Try again.' : err.message });
  }
};
