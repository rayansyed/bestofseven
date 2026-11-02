// Pack contents, kept free of I/O so they can be tested. Files starting with "_" aren't Vercel routes.
const STARTER_PACKS = 3;
const STARTER_SHAPE = ['G', 'G', 'F', 'F', 'C'];
// Starters leave out the league's best players, so earned packs and the market stay worth chasing.
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

module.exports = { makeStarterPack, STARTER_PACKS };
