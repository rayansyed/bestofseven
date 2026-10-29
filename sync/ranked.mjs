// Ranked nights: at lock, entries are split into groups of 10 by tier (empty seats get computer
// lineups); once every game is final, each group is scored and rank points are applied.
import { CAP, GROUP_SIZE, RP_BY_FINISH, TIERS, tierOf, invalidReason, scoreLineup, buildLineup, seeded, botName, botNoise } from './game.mjs';

export async function groupNight(db, day) {
  const date = day.date;
  const pmap = new Map(day.players.map(p => [p.id, p]));
  const entries = await db.query('entries', 'date', date);
  const humans = [], writes = [];
  for (const { id, data: e } of entries) {
    const bad = invalidReason(e, pmap);
    if (bad) { writes.push({ path: 'entries/' + id, data: { invalid: bad }, merge: true }); continue; }
    const user = (await db.read('users/' + e.uid)) || {};
    humans.push({ entryId: id, uid: e.uid, name: user.name || 'Player', rp: user.rp || 0, ids: e.ids, captain: e.captain ?? null, at: e.at || 0 });
  }

  const byTier = new Map();
  for (const h of humans) {
    const t = tierOf(h.rp);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(h);
  }
  let groups = 0;
  for (const [tier, list] of [...byTier].sort((a, b) => b[0] - a[0])) {
    list.sort((a, b) => b.rp - a.rp);
    for (let start = 0, n = 1; start < list.length; start += GROUP_SIZE, n++) {
      const gid = `${TIERS[tier].toLowerCase()}-${n}`;
      const members = list.slice(start, start + GROUP_SIZE).map(h => ({ key: h.uid, uid: h.uid, name: h.name, rpBefore: h.rp, ids: h.ids, captain: h.captain, at: h.at, bot: false }));
      for (let b = 0; members.length < GROUP_SIZE; b++) {
        const lu = buildLineup(day.players, { rnd: seeded(`${date}|${gid}|${b}`), noise: botNoise(tier), tries: 80 });
        if (!lu) break;
        members.push({ key: `bot-${b}`, uid: null, name: botName(b), ids: lu.ids, captain: lu.captain, at: Infinity, bot: true });
      }
      members.forEach(m => { if (m.at === Infinity) m.at = null; });
      writes.push({ path: `days/${date}/groups/${gid}`, data: { date, gid, tier, tierName: TIERS[tier], cap: CAP, members, scored: false } });
      for (const h of list.slice(start, start + GROUP_SIZE)) writes.push({ path: 'entries/' + h.entryId, data: { group: gid, tier }, merge: true });
      groups++;
    }
  }
  writes.push({ path: 'days/' + date, data: { grouped: true, groups, entrants: humans.length }, merge: true });
  await db.batch(writes);
  return { groups, entrants: humans.length };
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
        const promoted = tierOf(after) > tierBefore;
        r.rpDelta = delta; r.rpAfter = after;
        writes.push({ path: 'users/' + m.uid, data: {
          rp: after, tier: tierOf(after), shield: promoted ? 1 : 0,
          nights: (user.nights || 0) + 1, wins: (user.wins || 0) + (i === 0 ? 1 : 0),
          bestFinish: Math.min(user.bestFinish || 99, i + 1), lastNight: date,
        }, merge: true });
        writes.push({ path: `entries/${date}_${m.uid}`, data: { score: m.total, finish: i + 1, of: ranked.length, rpDelta: delta, rpAfter: after, tierName: TIERS[g.tier] }, merge: true });
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
