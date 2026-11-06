// Ranked weekly matchups. Each game night's lineups lock at the first tip-off; each valid lineup joins its
// owner's matchup for the week (Monday to Sunday). Players without one yet are paired with someone at a
// similar rank, and a computer takes an odd seat, setting a fresh lineup every night. When a night's games
// are final its stats are added to every matchup that week, and once the week's last game is final the nine
// categories over the whole week decide each matchup and rank points are applied.
// Nights grouped before matchups existed are scored by ranked-groups.mjs.
import { RP_WIN, RP_LOSS, SKIP_PENALTY, COINS, TIERS, tierOf, invalidReason, rewardFor, momentBadges, buildLineup, seeded, botName, botNoise, renameOldBot } from './game.mjs';
import { sideTotals, decide, addTotals, weekResult, weekOf, weekDates, duelsOf } from './battle.mjs';

const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, star: 4 };

// The player's cards by player id: the rarest copy's rarity, and the level picks of the copy carrying the levels.
async function collection(db, uid) {
  const owned = new Map();
  for (const { data: c } of await db.list(`users/${uid}/cards`)) {
    const o = owned.get(c.pid) || { rarity: null, level: 0, picks: [] };
    if ((RANK[c.rarity] ?? 0) >= (RANK[o.rarity] ?? -1)) { o.rarity = c.rarity || 'common'; o.star = c.rarity === 'star' ? c.star?.stat || null : null; }
    if ((c.level || 1) > o.level) { o.level = c.level || 1; o.picks = c.picks || []; }
    owned.set(c.pid, o);
  }
  return owned;
}

// Pair players within each tier by RP; leftovers pair across tiers; one odd player is left over.
function pair(players) {
  const byTier = new Map();
  for (const h of players) { const t = tierOf(h.rp); if (!byTier.has(t)) byTier.set(t, []); byTier.get(t).push(h); }
  const pairs = [], leftovers = [];
  for (const [, list] of [...byTier].sort((a, b) => b[0] - a[0])) {
    list.sort((a, b) => b.rp - a.rp);
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    if (list.length % 2) leftovers.push(list[list.length - 1]);
  }
  leftovers.sort((a, b) => b.rp - a.rp);
  for (let i = 0; i + 1 < leftovers.length; i += 2) pairs.push([leftovers[i], leftovers[i + 1]]);
  return { pairs, odd: leftovers.length % 2 ? leftovers[leftovers.length - 1] : null };
}

// At a night's lock: check entries, add each lineup to its owner's weekly matchup, and pair anyone new.
export async function lockNight(db, day) {
  const date = day.date, week = weekOf(date);
  const pmap = new Map(day.players.map(p => [p.id, p]));
  // A slot carries its card's rarity, archetypes and level picks (lv), as they were at lock.
  const slotsOf = (ids, cardOf) => ids.map(id => {
    if (!id) return null;
    const c = cardOf(id);
    return { id, rarity: c?.rarity || 'common', types: pmap.get(id)?.types || [], ...(c?.picks?.length ? { lv: c.picks } : {}), ...(c?.star ? { star: c.star } : {}) };
  });
  const matches = new Map((await db.query('matches', 'week', week)).map(m => [m.id, m.data]));
  // Computer opponents named under the old "Bot …" scheme get their new name (the matchups are rewritten below).
  for (const m of matches.values()) for (const s of m.sides || []) if (s.bot) s.name = renameOldBot(s.name);
  const seat = new Map();
  for (const [mid, m] of matches) m.sides.forEach((s, k) => { if (s.uid) seat.set(s.uid, [mid, k]); });

  const writes = [], lineups = [], unpaired = [];
  for (const { id, data: e } of await db.query('entries', 'date', date)) {
    const user = (await db.read('users/' + e.uid)) || {};
    const owned = await collection(db, e.uid);
    const bad = invalidReason({ ids: e.ids, captain: null }, pmap)
      || (e.ids.some(pid => pid && !owned.has(pid)) ? 'player not in your collection' : null);
    if (bad) { writes.push({ path: 'entries/' + id, data: { invalid: bad }, merge: true }); continue; }
    const h = { entryId: id, uid: e.uid, name: user.name || 'Player', rp: user.rp || 0, slots: slotsOf(e.ids, pid => owned.get(pid)) };
    // Booster cards attached to slots apply to tonight's game and are used up.
    const boosts = Object.entries(e.boosts || {});
    if (boosts.length) {
      const mine = new Map((await db.list(`users/${e.uid}/boosters`)).map(b => [b.id, b.data]));
      for (const [i, bid] of boosts) {
        const b = mine.get(bid), sl = h.slots[+i];
        if (!b || !sl || sl.boost) continue;
        sl.boost = { name: b.name, stat: b.stat, pct: b.pct };
        mine.delete(bid);
        writes.push({ path: `users/${e.uid}/boosters/${bid}`, del: true });
      }
    }
    lineups.push(h);
    if (!seat.has(e.uid)) unpaired.push(h);
  }

  // New matchups for players without one this week.
  const { pairs, odd } = pair(unpaired);
  if (odd) pairs.push([odd, null]);
  let n = matches.size;
  for (const sides of pairs) {
    const mid = `${week}_m${++n}`, tier = tierOf(Math.max(...sides.map(s => s?.rp || 0)));
    const side = (s, k) => s ? { key: s.uid, uid: s.uid, name: s.name, bot: false, rpBefore: s.rp } : { key: 'bot', uid: null, name: botName(n + k), bot: true, rpBefore: null };
    matches.set(mid, { week, mid, tier, tierName: TIERS[tier], uids: sides.map(s => s?.uid || null), sides: sides.map(side), nights: {}, scored: false, startedOn: date });
    sides.forEach((s, k) => { if (s) seat.set(s.uid, [mid, k]); });
  }

  // Tonight's lineups go into each matchup this week; computer seats pick a new lineup every night.
  for (const [mid, m] of matches) {
    // Firestore can't hold an array inside an array, so each side is its own map.
    const night = { sides: [{ slots: null, tot: null }, { slots: null, tot: null }] };
    m.sides.forEach((s, k) => {
      if (!s.bot) return;
      const lu = buildLineup(day.players, { rnd: seeded(`${date}|bot|${mid}`), noise: botNoise(m.tier), tries: 80, noCaptain: true });
      if (lu) night.sides[k].slots = slotsOf(lu.ids, () => null);
    });
    m.nights = { ...m.nights, [date]: night };
  }
  for (const h of lineups) {
    const [mid, k] = seat.get(h.uid);
    matches.get(mid).nights[date].sides[k].slots = h.slots;
    writes.push({ path: 'entries/' + h.entryId, data: { match: mid, week, side: k }, merge: true });
  }
  for (const [mid, m] of matches) writes.push({ path: 'matches/' + mid, data: m });
  writes.push({ path: 'days/' + date, data: { grouped: true, mode: 'week', matches: matches.size, entrants: lineups.length }, merge: true });
  await db.batch(writes);
  return { matches: matches.size, created: pairs.length, entrants: lineups.length };
}

// Once a night's games are final: store its totals in every matchup that week, and pay streaks and moments.
export async function scoreNight(db, day) {
  const date = day.date, week = weekOf(date), results = day.results || {}, writes = [];
  let scored = 0;
  for (const { id: mid, data: m } of await db.query('matches', 'week', week)) {
    const night = m.nights?.[date];
    if (!night) continue;
    const [a, b] = night.sides.map(x => x.slots);
    night.sides[0].tot = a ? sideTotals(a, b || [], results) : null;
    night.sides[1].tot = b ? sideTotals(b, a || [], results) : null;
    // Spot against spot: each duel won adds up over the week and breaks a tie in categories.
    const du = duelsOf(a || [], b || [], results);
    night.duels = du.wins;
    writes.push({ path: 'matches/' + mid, data: { nights: m.nights }, merge: true });
    // Tonight's head-to-head pays coins: a night win, every category won, every duel won and a sweep of all six
    // duels. A missing lineup counts as zeros.
    const zero = addTotals([]), night1 = decide(night.sides[0].tot || zero, night.sides[1].tot || zero, du.wins);
    for (let k = 0; k < 2; k++) {
      const me = m.sides[k];
      if (me.bot || !night.sides[k].slots) continue;
      const user = (await db.read('users/' + me.uid)) || {};
      const spots = night.sides[k].slots.length, sweep = spots > 0 && du.wins[k] === spots;
      const coins = (night1.winner === k ? COINS.nightWin : 0) + COINS.category * night1.wins[k] + COINS.duel * du.wins[k] + (sweep ? COINS.sweep : 0);
      const nightResult = night1.winner === k ? 'W' : night1.winner === 1 - k ? 'L' : 'T';
      const fp = night.sides[k].tot.fp, ids = night.sides[k].slots.map(s => s?.id || null);
      // The streak grows on every scored entry.
      const streak = (user.streak || 0) + 1, reward = rewardFor(streak);
      const rp = (user.rp || 0) + (reward?.rp || 0);
      const fresh = momentBadges(ids, null, day).filter(id => !user.moments?.[id]);
      writes.push({ path: 'users/' + me.uid, data: {
        ...(fresh.length ? { moments: { ...user.moments, ...Object.fromEntries(fresh.map(id => [id, date])) }, lastMoments: { date, ids: fresh } } : {}),
        rp, tier: tierOf(rp), nights: (user.nights || 0) + 1, lastNight: date, coins: (user.coins || 0) + coins,
        streak, bestStreak: Math.max(user.bestStreak || 0, streak), lastStreak: 0,
        bestTier: Math.max(user.bestTier || 0, tierOf(rp)), bestScore: Math.max(user.bestScore || 0, fp),
        ...(reward ? { savers: (user.savers || 0) + reward.saver, badge: !!user.badge || reward.badge, lastReward: { date, streak, ...reward } } : {}),
      }, merge: true });
      writes.push({ path: `entries/${date}_${me.uid}`, data: { score: fp, scored: true, streak, reward: reward || null, nightResult, nightCats: [night1.wins[k], night1.wins[1 - k]], duels: [du.wins[k], du.wins[1 - k]], sweep, coins }, merge: true });
    }
    scored++;
  }
  writes.push({ path: 'days/' + date, data: { scored: true }, merge: true });
  await db.batch(writes);
  return { scored };
}

// Decides every matchup whose week is over and whose game nights are all final and scored.
export async function scoreWeeks(db, today) {
  const current = weekOf(today), writes = [];
  let done = 0;
  for (const { id: mid, data: m } of await db.query('matches', 'scored', false)) {
    if (m.week >= current) continue;
    const nights = await Promise.all(weekDates(m.week).map(d => db.read('days/' + d)));
    if (nights.some(d => d && d.grouped && (!d.final || !d.scored))) continue;
    const r = weekResult(m.nights);
    for (let k = 0; k < 2; k++) {
      const me = m.sides[k], opp = m.sides[1 - k];
      if (me.bot) continue;
      const user = (await db.read('users/' + me.uid)) || {};
      const won = r.winner === k, lost = r.winner === 1 - k;
      const before = user.rp || 0, tierBefore = tierOf(before);
      let after = Math.max(0, before + (won ? RP_WIN : lost ? RP_LOSS : 0));
      // A player can't drop out of a tier the week after reaching it.
      if (user.shield && tierOf(after) < tierBefore) after = tierBefore * 100;
      const promoted = tierOf(after) > tierBefore;
      const coins = won ? COINS.weekWin : 0;
      const res = { week: m.week, mid, result: won ? 'W' : lost ? 'L' : 'T', cats: [r.wins[k], r.wins[1 - k]], duels: [r.duels[k], r.duels[1 - k]], opp: opp.name, rpDelta: after - before, rpAfter: after, coins };
      writes.push({ path: 'users/' + me.uid, data: {
        coins: (user.coins || 0) + coins,
        rp: after, tier: tierOf(after), shield: promoted ? 1 : 0, bestTier: Math.max(user.bestTier || 0, tierOf(after)),
        wins: (user.wins || 0) + (won ? 1 : 0), losses: (user.losses || 0) + (lost ? 1 : 0), lastWeek: res,
      }, merge: true });
      m.sides[k] = { ...me, rpDelta: res.rpDelta, coins };
    }
    writes.push({ path: 'matches/' + mid, data: { scored: true, result: r, sides: m.sides }, merge: true });
    done++;
  }
  if (writes.length) await db.batch(writes);
  return done;
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

// The night's three best real lineups by fantasy points, for the page's podium. Computer lineups never count.
export async function bestSquads(db, day) {
  const squads = [];
  for (const { data: m } of await db.query('matches', 'week', weekOf(day.date))) {
    const night = m.nights?.[day.date];
    if (!night) continue;
    m.sides.forEach((s, k) => {
      if (s.bot || !night.sides[k].slots) return;
      const total = night.sides[k].tot?.fp ?? sideTotals(night.sides[k].slots, night.sides[1 - k].slots || [], day.results || {}).fp;
      squads.push({ uid: s.uid, name: s.name, tier: m.tier, ids: night.sides[k].slots.map(x => x?.id || null), captain: null, total });
    });
  }
  return squads.sort((a, b) => b.total - a.total).slice(0, 3);
}
