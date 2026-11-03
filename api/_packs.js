// Pack contents, kept free of I/O so they can be tested. Files starting with "_" aren't Vercel routes.
const STARTER_PACKS = 3;
const STARTER_SHAPE = ['G', 'G', 'F', 'F', 'C'];
// Starters leave out the league's best players, so earned packs stay worth chasing.
const STARTER_MAX_STARS = 3;

/**
 * Five cards for a new player's starter pack: 2 G, 2 F and 1 C, all Common, none they already own.
 * The first pack favours players whose teams play in the next two days, so a first lineup is always fillable.
 * @param {{ roster: Array, owned: Set<string>, packNo: number, upcomingTeams: Set<string>, rnd?: () => number }} o
 */
function makeStarterPack({ roster, owned, packNo, upcomingTeams, rnd = Math.random }) {
  const taken = new Set(owned);
  const base = roster.filter(p => p.gp > 0 && p.stars <= STARTER_MAX_STARS && !taken.has(p.id));
  const cards = [];
  for (const pos of STARTER_SHAPE) {
    const fits = p => p.pos === pos && !taken.has(p.id);
    let pool = base.filter(fits);
    if (packNo === 0) {
      const soon = pool.filter(p => upcomingTeams.has(p.team));
      if (soon.length) pool = soon;
    }
    if (!pool.length) pool = roster.filter(fits); // a thin position: fall back to anyone unowned
    if (!pool.length) continue;
    const p = pool[Math.floor(rnd() * pool.length)];
    taken.add(p.id);
    cards.push({ pid: p.id, name: p.name, team: p.team, pos: p.pos, rarity: 'common', source: 'starter' });
  }
  return cards;
}

/* ---------- The pack shop ---------- */
// Rarity odds per pack, best last: [chance, rarity].
const PACKS = {
  daily: { name: 'Daily pack', price: 0, players: 3, boosters: 1, tonight: true,
    odds: [[0.80, 'common'], [0.15, 'rare'], [0.045, 'epic'], [0.005, 'legendary']] },
  standard: { name: 'Standard pack', price: 150, players: 4, boosters: 1,
    odds: [[0.74, 'common'], [0.19, 'rare'], [0.06, 'epic'], [0.01, 'legendary']] },
  premium: { name: 'Premium pack', price: 400, players: 5, boosters: 2, guarantee: 'rare',
    odds: [[0.45, 'common'], [0.35, 'rare'], [0.15, 'epic'], [0.05, 'legendary']] },
};
// Booster cards: one game's lift to one stat, or to every stat. For turnovers the lift means fewer.
// "Soft Touch" lifts made shots, which raises FG%.
const BOOSTERS = [
  { bid: 'scorer', name: 'Bucket Getter', stat: 'pts', pct: 0.15, weight: 10 },
  { bid: 'glass', name: 'Glass Cleaner', stat: 'reb', pct: 0.15, weight: 10 },
  { bid: 'dimes', name: 'Dime Dropper', stat: 'ast', pct: 0.15, weight: 10 },
  { bid: 'hands', name: 'Quick Hands', stat: 'stl', pct: 0.20, weight: 8 },
  { bid: 'swat', name: 'Swat Team', stat: 'blk', pct: 0.20, weight: 8 },
  { bid: 'splash', name: 'Splash Zone', stat: 'tpm', pct: 0.20, weight: 8 },
  { bid: 'stripe', name: 'Charity Stripe', stat: 'ftm', pct: 0.15, weight: 8 },
  { bid: 'touch', name: 'Soft Touch', stat: 'fgm', pct: 0.08, weight: 6 },
  { bid: 'secure', name: 'Ball Security', stat: 'to', pct: 0.20, weight: 6 },
  { bid: 'allstar', name: 'All-Star Night', stat: 'all', pct: 0.08, weight: 3 },
];
// Coins for selling a card. Mostly for duplicates.
const SELL_VALUE = { common: 10, rare: 30, epic: 75, legendary: 200 };
const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
// Lower-rated players turn up more often.
const STAR_WEIGHT = { 1: 5, 2: 5, 3: 4, 4: 2, 5: 1 };

function weighted(list, weight, rnd) {
  const total = list.reduce((s, x) => s + weight(x), 0);
  let x = rnd() * total;
  for (const item of list) { if ((x -= weight(item)) < 0) return item; }
  return list[list.length - 1];
}
function pickRarity(odds, rnd) {
  let x = rnd();
  for (const [p, r] of odds) { if ((x -= p) < 0) return r; }
  return odds[0][1];
}

/**
 * A shop pack: player cards (duplicates allowed, which is what selling is for) plus booster cards.
 * teams limits the players to those teams, for the daily pack's "plays tonight" cards.
 * @param {{ roster: Array, kind: 'daily'|'standard'|'premium', teams?: Set<string>|null, rnd?: () => number }} o
 */
function makePack({ roster, kind, teams = null, rnd = Math.random }) {
  const def = PACKS[kind];
  let pool = roster.filter(p => p.gp > 0 && (!teams || teams.has(p.team)));
  if (pool.length < def.players) pool = roster.filter(p => p.gp > 0);
  const used = new Set(), cards = [];
  for (let n = 0; n < def.players && pool.length > used.size; n++) {
    const p = weighted(pool.filter(x => !used.has(x.id)), x => STAR_WEIGHT[x.stars] || 1, rnd);
    used.add(p.id);
    cards.push({ pid: p.id, name: p.name, team: p.team, pos: p.pos, rarity: pickRarity(def.odds, rnd), source: kind });
  }
  if (def.guarantee && cards.length && !cards.some(c => RANK[c.rarity] >= RANK[def.guarantee])) cards[cards.length - 1].rarity = def.guarantee;
  const boosters = Array.from({ length: def.boosters }, () => {
    const { weight, ...b } = weighted(BOOSTERS, x => x.weight, rnd);
    return { ...b, source: kind };
  });
  return { cards, boosters };
}

module.exports = { makeStarterPack, STARTER_PACKS, PACKS, BOOSTERS, SELL_VALUE, makePack };
