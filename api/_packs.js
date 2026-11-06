// Pack contents, kept free of I/O so they can be tested. Files starting with "_" aren't Vercel routes.
const STARTER_PACKS = 3;
const STARTER_SHAPE = ['G', 'G', 'F', 'F', 'C'];
// Starters leave out the league's best players, so earned packs stay worth chasing.
const STARTER_MAX_STARS = 3;
// Players who barely get on the floor never turn up in packs. A roster without minutes yet lets everyone in.
const MIN_MPG = 12;
const plays = p => p.gp > 0 && (p.mpg ?? MIN_MPG) >= MIN_MPG;

/**
 * Five cards for a new player's starter pack: 2 G, 2 F and 1 C, all Common, none they already own.
 * The first pack favours players whose teams play in the next two days, so a first lineup is always fillable.
 * @param {{ roster: Array, owned: Set<string>, packNo: number, upcomingTeams: Set<string>, rnd?: () => number }} o
 */
function makeStarterPack({ roster, owned, packNo, upcomingTeams, rnd = Math.random }) {
  const taken = new Set(owned);
  const base = roster.filter(p => plays(p) && p.stars <= STARTER_MAX_STARS && !taken.has(p.id));
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

// Teams on the slates you can still enter, soonest first. A slate whose first tip-off has passed is skipped, so
// "plays tonight" cards are ones you can actually use. days holds slate documents (null for a day with none).
function openSlateTeams(days, now = Date.now()) {
  return days.filter(d => d && (d.games || []).length && now < (d.lockMs || Date.parse(d.lockAt)))
    .map(d => new Set(d.games.flatMap(g => [g.away, g.home])));
}

/* ---------- The pack shop ---------- */
// Prices and the rarity odds of each player card, best last: [chance, rarity]. Packs are priced to be opened often,
// so the top rarities are kept rare. Keep prices in step with SHOP in index.html.
const PACKS = {
  daily: { name: 'Daily pack', price: 0, players: 3, boosters: 1, tonight: true,
    odds: [[0.80, 'common'], [0.15, 'rare'], [0.045, 'epic'], [0.005, 'legendary']] },
  standard: { name: 'Standard pack', price: 80, players: 4, boosters: 1,
    odds: [[0.74, 'common'], [0.19, 'rare'], [0.065, 'epic'], [0.005, 'legendary']] },
  premium: { name: 'Premium pack', price: 200, players: 5, boosters: 2, guarantee: 'rare',
    odds: [[0.45, 'common'], [0.35, 'rare'], [0.175, 'epic'], [0.025, 'legendary']] },
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
const SELL_VALUE = { common: 10, rare: 30, epic: 75, legendary: 200, star: 300 };
const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, star: 4 };
// Special cards: one shared chance per pack that its last player is swapped for a special card. Which one comes from
// the programs running now (specialsFor), picked by weight, so adding programs never changes how often packs hit.
const SPECIAL_ODDS = { daily: 1 / 60, standard: 1 / 25, premium: 1 / 10 };
// The Monday (YYYYMMDD) of the week a US Eastern date falls in.
function weekOf(date) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
// The Weekly Stars in packs on a date: the team stored on meta/roster whose pack week this is.
const starsFor = (rosterDoc, date) => rosterDoc && rosterDoc.stars && rosterDoc.stars.packWeek === weekOf(date) ? rosterDoc.stars.players || [] : [];
// The special-card programs in packs on a date: { id, weight, cards } with pack-ready cards. To add a program, push
// it here with its cards (each with its own rarity, e.g. 'star') and a weight; give it a card design in index.html.
function specialsFor(rosterDoc, date) {
  const programs = [];
  const stars = starsFor(rosterDoc, date);
  if (stars.length) programs.push({ id: 'weekly-star', weight: 1, cards: stars.map(s => ({ pid: s.pid, name: s.name, team: s.team, pos: s.pos, rarity: 'star',
    star: { week: rosterDoc.stars.week || null, stat: s.stat, label: s.label, statPg: s.statPg, fpg: s.fpg, caption: s.caption, slot: s.slot } })) });
  return programs;
}
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
// Rarer cards are better players: the star ratings each rarity draws from. A Legendary is always a 5★ star.
const RARITY_STARS = { common: [1, 2], rare: [2, 3], epic: [3, 4], legendary: [5, 5] };

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
 * Each card's rarity is rolled first, then a player rated for that rarity is drawn. teams limits players to
 * those teams, for the daily pack's "plays tonight" cards; if none of them fit a rarity, the card drops a rarity.
 * specials (from specialsFor) can put a special card in place of the last player, at SPECIAL_ODDS.
 * @param {{ roster: Array, kind: 'daily'|'standard'|'premium', teams?: Set<string>|null, specials?: Array, rnd?: () => number }} o
 */
function makePack({ roster, kind, teams = null, specials = [], rnd = Math.random }) {
  const def = PACKS[kind];
  let pool = roster.filter(p => plays(p) && (!teams || teams.has(p.team)));
  if (pool.length < def.players) pool = roster.filter(plays);
  const rarities = Array.from({ length: def.players }, () => pickRarity(def.odds, rnd));
  if (def.guarantee && !rarities.some(r => RANK[r] >= RANK[def.guarantee])) rarities[rarities.length - 1] = def.guarantee;
  const used = new Set(), cards = [];
  for (let rarity of rarities) {
    const fits = r => pool.filter(p => !used.has(p.id) && p.stars >= RARITY_STARS[r][0] && p.stars <= RARITY_STARS[r][1]);
    let options = fits(rarity);
    while (!options.length && RANK[rarity] > 0) { rarity = RARITIES[RANK[rarity] - 1]; options = fits(rarity); }
    if (!options.length) options = pool.filter(p => !used.has(p.id));
    if (!options.length) break;
    const p = options[Math.floor(rnd() * options.length)];
    used.add(p.id);
    cards.push({ pid: p.id, name: p.name, team: p.team, pos: p.pos, rarity, source: kind });
  }
  const live = specials.map(p => ({ ...p, cards: (p.cards || []).filter(c => !cards.slice(0, -1).some(x => x.pid === c.pid)) })).filter(p => p.cards.length && p.weight > 0);
  if (cards.length && live.length && rnd() < SPECIAL_ODDS[kind]) {
    const program = weighted(live, p => p.weight, rnd), c = program.cards[Math.floor(rnd() * program.cards.length)];
    cards[cards.length - 1] = { ...c, source: kind, program: program.id };
  }
  const boosters = Array.from({ length: def.boosters }, () => {
    const { weight, ...b } = weighted(BOOSTERS, x => x.weight, rnd);
    return { ...b, source: kind };
  });
  return { cards, boosters };
}

// Levelling up a card: each level uses LEVEL.cost duplicate copies of the player and adds LEVEL.bonus to one category
// the player picks (fgm lifts FG%, to cuts turnovers). Keep in step with sync/battle.mjs and index.html.
const LEVEL = { cost: 2, max: 3, bonus: 0.05, stats: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fgm', 'ftm', 'to'] };

module.exports = { makeStarterPack, STARTER_PACKS, PACKS, BOOSTERS, SELL_VALUE, RARITY_STARS, MIN_MPG, makePack, openSlateTeams, LEVEL, RANK, SPECIAL_ODDS, starsFor, specialsFor, weekOf };
