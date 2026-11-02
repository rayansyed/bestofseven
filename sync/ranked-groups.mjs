// Legacy group nights (groups of 10 by tier). Nights grouped before 1v1 battles are still scored here;
// new nights use ranked.mjs, which also applies skipped-night penalties for every night.
import { RP_BY_FINISH, TIERS, tierOf, rewardFor, momentBadges, scoreLineup } from './game.mjs';

export async function bestSquads(db, day) {
  const squads = [];
  for (const { data: g } of await db.list(`days/${day.date}/groups`)) {
    for (const m of g.members) {
      if (m.bot) continue;
      squads.push({ uid: m.uid, name: m.name, tier: g.tier, ids: m.ids, captain: m.captain ?? null, at: m.at ?? null, ...scoreLineup(m.ids, m.captain, day.results || {}) });
    }
  }
  return squads.sort((a, b) => b.total - a.total || b.best - a.best || (a.at ?? Infinity) - (b.at ?? Infinity)).slice(0, 3)
    .map(({ uid, name, tier, ids, captain, total }) => ({ uid, name, tier, ids, captain, total }));
}

export async function scoreNight(db, day) {
  const date = day.date;
  const groups = await db.list(`days/${date}/groups`);
  const writes = [];
  let scored = 0;
  for (const { id: gid, data: g } of groups) {
    if (g.scored) continue;
    const ranked = g.members.map(m => ({ ...m, ...scoreLineup(m.ids, m.captain, day.results || {}) }))
      // Ties: best single performance, then whoever saved their entry first; bots last.
      .sort((a, b) => b.total - a.total || b.best - a.best || (a.at ?? Infinity) - (b.at ?? Infinity));
    const results = [];
    for (let i = 0; i < ranked.length; i++) {
      const m = ranked[i], r = { key: m.key, total: m.total, finish: i + 1 };
      if (!m.bot) {
        const user = (await db.read('users/' + m.uid)) || {};
        const before = user.rp || 0, tierBefore = tierOf(before);
        let delta = RP_BY_FINISH[i] ?? -15;
        let after = Math.max(0, before + delta);
        // A player can't drop out of a tier on the first night after reaching it.
        if (user.shield && tierOf(after) < tierBefore) after = tierBefore * 100;
        delta = after - before;
        // The streak grows on every scored entry, whatever the finish.
        const streak = (user.streak || 0) + 1, reward = rewardFor(streak);
        after += reward?.rp || 0;
        const promoted = tierOf(after) > tierBefore;
        r.rpDelta = delta; r.rpAfter = after;
        // Moment badges earned tonight that the player didn't already have.
        const fresh = momentBadges(m.ids, m.captain, day).filter(id => !user.moments?.[id]);
        writes.push({ path: 'users/' + m.uid, data: {
          ...(fresh.length ? { moments: { ...user.moments, ...Object.fromEntries(fresh.map(id => [id, date])) }, lastMoments: { date, ids: fresh } } : {}),
          rp: after, tier: tierOf(after), shield: promoted ? 1 : 0,
          nights: (user.nights || 0) + 1, wins: (user.wins || 0) + (i === 0 ? 1 : 0),
          bestFinish: Math.min(user.bestFinish || 99, i + 1), lastNight: date,
          streak, bestStreak: Math.max(user.bestStreak || 0, streak), lastStreak: 0,
          bestTier: Math.max(user.bestTier || 0, tierOf(after)), bestScore: Math.max(user.bestScore || 0, m.total),
          ...(reward ? {
            savers: (user.savers || 0) + reward.saver,
            badge: !!user.badge || reward.badge, lastReward: { date, streak, ...reward },
          } : {}),
        }, merge: true });
        writes.push({ path: `entries/${date}_${m.uid}`, data: { score: m.total, finish: i + 1, of: ranked.length, rpDelta: delta, rpAfter: after, tierName: TIERS[g.tier], streak, reward: reward || null }, merge: true });
      }
      results.push(r);
    }
    writes.push({ path: `days/${date}/groups/${gid}`, data: { scored: true, results }, merge: true });
    scored++;
  }
  writes.push({ path: 'days/' + date, data: { scored: true }, merge: true });
  await db.batch(writes);
  return { scored };
}
