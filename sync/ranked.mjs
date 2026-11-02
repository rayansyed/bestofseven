// Ranked 1v1 nights. At lock, valid entries are paired with one opponent at a similar rank (a computer
// lineup takes the odd seat). Once every game is final, each battle is decided on nine categories and
// rank points are applied. Nights grouped before battles existed are scored by ranked-groups.mjs.
import { RP_WIN, RP_LOSS, SKIP_PENALTY, TIERS, tierOf, invalidReason, rewardFor, momentBadges, buildLineup, seeded, botName, botNoise } from './game.mjs';
import { battle } from './battle.mjs';

const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

// The player's cards by player id, keeping the rarest copy.
async function collection(db, uid) {
  const owned = new Map();
  for (const { data: c } of await db.list(`users/${uid}/cards`)) {
    if ((RANK[c.rarity] ?? 0) >= (RANK[owned.get(c.pid)] ?? -1)) owned.set(c.pid, c.rarity || 'common');
  }
  return owned;
}

export async function pairNight(db, day) {
  const date = day.date;
  const pmap = new Map(day.players.map(p => [p.id, p]));
  const slotsOf = (ids, rarityOf) => ids.map(id => ({ id, rarity: rarityOf(id), types: pmap.get(id)?.types || [] }));
  const humans = [], writes = [];
  for (const { id, data: e } of await db.query('entries', 'date', date)) {
    const user = (await db.read('users/' + e.uid)) || {};
    const owned = await collection(db, e.uid);
    const bad = invalidReason({ ids: e.ids, captain: null }, pmap)
      || (e.ids.some(pid => pid && !owned.has(pid)) ? 'player not in your collection' : null);
    if (bad) { writes.push({ path: 'entries/' + id, data: { invalid: bad }, merge: true }); continue; }
    humans.push({ entryId: id, key: e.uid, uid: e.uid, name: user.name || 'Player', rp: user.rp || 0, ids: e.ids, slots: slotsOf(e.ids, pid => owned.get(pid)), at: e.at || 0, bot: false });
  }

  // Pair within each tier by RP; leftovers pair across neighbouring tiers; one odd seat gets a computer.
  const byTier = new Map();
  for (const h of humans) { const t = tierOf(h.rp); if (!byTier.has(t)) byTier.set(t, []); byTier.get(t).push(h); }
  const pairs = [], leftovers = [];
  for (const [, list] of [...byTier].sort((a, b) => b[0] - a[0])) {
    list.sort((a, b) => b.rp - a.rp);
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    if (list.length % 2) leftovers.push(list[list.length - 1]);
  }
  leftovers.sort((a, b) => b.rp - a.rp);
  for (let i = 0; i + 1 < leftovers.length; i += 2) pairs.push([leftovers[i], leftovers[i + 1]]);
  if (leftovers.length % 2) {
    const h = leftovers[leftovers.length - 1], tier = tierOf(h.rp);
    const lu = buildLineup(day.players, { rnd: seeded(`${date}|bot|${h.uid}`), noise: botNoise(tier), tries: 80, noCaptain: true });
    if (lu) pairs.push([h, { key: 'bot', uid: null, name: botName(pairs.length), ids: lu.ids, slots: slotsOf(lu.ids, () => 'common'), at: null, bot: true }]);
  }

  pairs.forEach((sides, n) => {
    const mid = `m${n + 1}`, tier = tierOf(Math.max(...sides.map(s => s.rp || 0)));
    writes.push({ path: `days/${date}/matches/${mid}`, data: { date, mid, tier, tierName: TIERS[tier], sides: sides.map(({ entryId, rp, ...s }) => ({ ...s, rpBefore: rp ?? null })), scored: false } });
    sides.forEach((s, k) => { if (!s.bot) writes.push({ path: 'entries/' + s.entryId, data: { match: mid, side: k, tier }, merge: true }); });
  });
  writes.push({ path: 'days/' + date, data: { grouped: true, mode: 'battle', matches: pairs.length, entrants: humans.length }, merge: true });
  await db.batch(writes);
  return { matches: pairs.length, entrants: humans.length };
}

export async function scoreBattles(db, day) {
  const date = day.date, writes = [];
  let scored = 0;
  for (const { id: mid, data: m } of await db.list(`days/${date}/matches`)) {
    if (m.scored) continue;
    const r = battle(m.sides[0].slots, m.sides[1].slots, day.results || {});
    for (let k = 0; k < 2; k++) {
      const me = m.sides[k], opp = m.sides[1 - k];
      if (me.bot) continue;
      const user = (await db.read('users/' + me.uid)) || {};
      const won = r.winner === k, lost = r.winner === 1 - k;
      const before = user.rp || 0, tierBefore = tierOf(before);
      let after = Math.max(0, before + (won ? RP_WIN : lost ? RP_LOSS : 0));
      // A player can't drop out of a tier on the first night after reaching it.
      if (user.shield && tierOf(after) < tierBefore) after = tierBefore * 100;
      const delta = after - before;
      // The streak grows on every scored entry, win or lose.
      const streak = (user.streak || 0) + 1, reward = rewardFor(streak);
      after += reward?.rp || 0;
      const promoted = tierOf(after) > tierBefore;
      const fresh = momentBadges(me.ids, null, day).filter(id => !user.moments?.[id]);
      writes.push({ path: 'users/' + me.uid, data: {
        ...(fresh.length ? { moments: { ...user.moments, ...Object.fromEntries(fresh.map(id => [id, date])) }, lastMoments: { date, ids: fresh } } : {}),
        rp: after, tier: tierOf(after), shield: promoted ? 1 : 0,
        nights: (user.nights || 0) + 1, wins: (user.wins || 0) + (won ? 1 : 0), losses: (user.losses || 0) + (lost ? 1 : 0), lastNight: date,
        streak, bestStreak: Math.max(user.bestStreak || 0, streak), lastStreak: 0,
        bestTier: Math.max(user.bestTier || 0, tierOf(after)), bestScore: Math.max(user.bestScore || 0, r.fp[k]),
        ...(reward ? {
          savers: (user.savers || 0) + reward.saver,
          badge: !!user.badge || reward.badge, lastReward: { date, streak, ...reward },
        } : {}),
      }, merge: true });
      writes.push({ path: `entries/${date}_${me.uid}`, data: {
        result: won ? 'W' : lost ? 'L' : 'T', cats: [r.wins[k], r.wins[1 - k]], score: r.fp[k], opp: opp.name,
        rpDelta: delta, rpAfter: after, tierName: TIERS[m.tier], streak, reward: reward || null,
      }, merge: true });
    }
    writes.push({ path: `days/${date}/matches/${mid}`, data: { scored: true, result: r }, merge: true });
    scored++;
  }
  writes.push({ path: 'days/' + date, data: { scored: true }, merge: true });
  await db.batch(writes);
  return { scored };
}

// Returning players who didn't enter lose a little RP (never their tier) and their streak, unless a
// Streak Saver covers the night. An invalid entry counts as entering: no penalty, and the streak holds.
export async function applySkips(db, date) {
  const entered = new Set((await db.query('entries', 'date', date)).map(e => e.data.uid));
  const writes = [];
  for (const { id, data: u } of await db.list('users')) {
    if (!u.nights || entered.has(id) || (u.lastNight || '') >= date) continue;
    if ((u.savers || 0) > 0) { writes.push({ path: 'users/' + id, data: { savers: u.savers - 1, lastSaved: date }, merge: true }); continue; }
    const rp = u.rp || 0, after = Math.max(tierOf(rp) * 100, rp - SKIP_PENALTY);
    writes.push({ path: 'users/' + id, data: { rp: after, lastSkip: date, lastSkipRp: after - rp, streak: 0, lastStreak: u.streak || 0 }, merge: true });
  }
  if (writes.length) await db.batch(writes);
  return writes.length;
}

// The night's three best real squads by fantasy points, for the page's podium. Computer lineups never count.
export async function bestSquads(db, day) {
  const squads = [];
  for (const { data: m } of await db.list(`days/${day.date}/matches`)) {
    const r = m.result || battle(m.sides[0].slots, m.sides[1].slots, day.results || {});
    m.sides.forEach((s, k) => { if (!s.bot) squads.push({ uid: s.uid, name: s.name, tier: m.tier, ids: s.ids, captain: null, at: s.at ?? null, total: r.fp[k] }); });
  }
  return squads.sort((a, b) => b.total - a.total || (a.at ?? Infinity) - (b.at ?? Infinity)).slice(0, 3)
    .map(({ uid, name, tier, ids, captain, total }) => ({ uid, name, tier, ids, captain, total }));
}
