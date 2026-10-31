// Game rules shared by the sync (grouping, bots, scoring, ranks).
// index.html carries a copy of the lineup rules and builder; keep the two in step.
export const SLOTS = ['G', 'G', 'F', 'F', 'C', 'UTIL'];
export const CAP = 16;          // star budget for six players
export const CAPTAIN_X = 1.5;   // the captain scores 1.5×…
export const CAPTAIN_EXTRA = 1; // …and costs one extra star
export const MAX_FIVE = 1;      // at most one 5★ player per lineup
export const GROUP_SIZE = 10;
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite'];
// Rank points by finish in a group of 10 (index 0 = 1st place).
export const RP_BY_FINISH = [30, 20, 20, 5, 5, -5, -5, -15, -15, -15];
export const SKIP_PENALTY = 3; // RP lost for skipping a game night; never drops a player out of their tier

export const fpOf = l => l[1] + 1.2 * l[2] + 1.5 * l[3] + 3 * l[4] + 3 * l[5] - l[6];
// Star rating from fantasy points per game: 45+ = 5★, 35+ = 4★, 25+ = 3★, 15+ = 2★, else 1★.
export const starsOf = avg => avg >= 45 ? 5 : avg >= 35 ? 4 : avg >= 25 ? 3 : avg >= 15 ? 2 : 1;
export const tierOf = rp => Math.min(TIERS.length - 1, Math.floor(Math.max(0, rp) / 100));
export const isOut = p => /out|suspend/i.test(p.status || '');
const elig = (slot, p) => slot === 'UTIL' || p.pos === slot;

export function lineupCost(ids, captain, pmap) {
  return ids.reduce((s, id) => s + (id ? pmap.get(id).stars : 0), 0) + (captain && ids.includes(captain) ? CAPTAIN_EXTRA : 0);
}
export const fiveStars = (ids, pmap) => ids.filter(id => id && pmap.get(id).stars === 5).length;

// Null when the entry is a legal lineup for this pool, otherwise the reason.
export function invalidReason(e, pmap) {
  if (!Array.isArray(e.ids) || e.ids.length !== 6) return 'needs six players';
  if (new Set(e.ids).size !== 6) return 'duplicate player';
  for (let i = 0; i < 6; i++) {
    const p = pmap.get(e.ids[i]);
    if (!p) return 'player not on this slate';
    if (!elig(SLOTS[i], p)) return 'player in the wrong slot';
  }
  if (e.captain != null && !e.ids.includes(e.captain)) return 'captain not in lineup';
  if (fiveStars(e.ids, pmap) > MAX_FIVE) return 'more than one 5★ player';
  if (lineupCost(e.ids, e.captain, pmap) > CAP) return 'over the star budget';
  return null;
}

export function scoreLineup(ids, captain, results) {
  let total = 0, best = 0;
  for (const id of ids) {
    const line = results[id];
    const fp = line ? fpOf(line) * (id === captain ? CAPTAIN_X : 1) : 0;
    total += fp; best = Math.max(best, fp);
  }
  return { total: Math.round(total * 10) / 10, best };
}

export function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// Random legal lineups, then greedy upgrades, keeping the best. `noise` blurs the
// projections so computer lineups differ and aren't perfect.
export function buildLineup(players, { base = SLOTS.map(() => null), captain = null, rnd = Math.random, noise = 0, tries = 200 } = {}) {
  const pmap = new Map(players.map(p => [p.id, p]));
  const pl = players.filter(p => p.gp > 0 && !isOut(p));
  if (!pl.length) return null;
  const randn = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const val = new Map(pl.map(p => [p.id, p.avg * (1 + noise * randn())]));
  const v = id => val.get(id) ?? pmap.get(id)?.avg ?? 0;
  const free = SLOTS.map((_, i) => i).filter(i => !base[i]);
  const fixedCap = captain && base.includes(captain) ? captain : null;
  // The captain is the best projected player, when the extra star fits.
  const pickCaptain = lu => fixedCap || (lineupCost(lu, null, pmap) + CAPTAIN_EXTRA <= CAP ? lu.slice().sort((a, b) => v(b) - v(a))[0] : null);
  const legal = (lu, c) => lineupCost(lu, c, pmap) <= CAP && fiveStars(lu, pmap) <= MAX_FIVE;
  const score = (lu, c) => lu.reduce((a, id) => a + v(id), 0) + (c ? v(c) * (CAPTAIN_X - 1) : 0);
  let best = null, bestV = -Infinity;
  for (let t = 0; t < tries; t++) {
    const lu = base.slice();
    let ok = true;
    const order = free.slice().sort(() => rnd() - .5).sort((a, b) => (a === 5) - (b === 5));
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const budget = CAP - lineupCost(lu, fixedCap, pmap) - (order.length - k - 1);
      const fiveOk = fiveStars(lu, pmap) < MAX_FIVE;
      const c = pl.filter(p => elig(SLOTS[i], p) && !lu.includes(p.id) && p.stars <= budget && (fiveOk || p.stars < 5));
      if (!c.length) { ok = false; break; }
      lu[i] = c[Math.floor(rnd() * c.length)].id;
    }
    if (!ok) continue;
    let cap = pickCaptain(lu), cur = score(lu, cap);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (const i of free) {
        const was = lu[i];
        for (const p of pl) {
          if (!elig(SLOTS[i], p) || lu.includes(p.id)) continue;
          lu[i] = p.id;
          const c2 = pickCaptain(lu);
          if (legal(lu, c2) && score(lu, c2) > cur + 1e-9) { cur = score(lu, c2); cap = c2; improved = true; break; }
          lu[i] = was;
        }
      }
      if (!improved) break;
    }
    if (legal(lu, cap) && cur > bestV) { bestV = cur; best = { ids: lu.slice(), captain: cap }; }
  }
  return best;
}

const BOT_NAMES = ['Bot Rookie', 'Bot Sixth Man', 'Bot Glue Guy', 'Bot Sharpshooter', 'Bot Rim Runner', 'Bot Floor General', 'Bot Stretch Four', 'Bot Iron Man', 'Bot Spark Plug', 'Bot Closer'];
export const botName = i => BOT_NAMES[i % BOT_NAMES.length];
// Computer lineups get sharper as tiers rise.
export const botNoise = tier => Math.max(0.08, 0.38 - 0.06 * tier);
