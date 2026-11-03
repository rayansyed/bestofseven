// Weekly head-to-head matchups: each night both players field six cards, their real box scores
// (after boosts, counters and combos) add up Monday to Sunday, and nine categories decide the week.
// index.html carries a copy of this file's rules for the live board; keep the two in step.
//
// A box score line is [min, pts, reb, ast, stl, blk, to, threes, fgm, fga, ftm].
export const STAT = { min: 0, pts: 1, reb: 2, ast: 3, stl: 4, blk: 5, to: 6, tpm: 7, fgm: 8, fga: 9, ftm: 10 };
export const fpOf = l => l[1] + 1.2 * l[2] + 1.5 * l[3] + 3 * l[4] + 3 * l[5] - l[6];

// Nine categories; an odd count gives most matchups a clear winner. Fewer turnovers wins.
export const CATS = [
  { key: 'pts', name: 'Points' }, { key: 'reb', name: 'Rebounds' }, { key: 'ast', name: 'Assists' },
  { key: 'stl', name: 'Steals' }, { key: 'blk', name: 'Blocks' }, { key: 'tpm', name: 'Threes made' },
  { key: 'fgp', name: 'FG%' }, { key: 'ftm', name: 'Free throws made' }, { key: 'to', name: 'Turnovers', low: true },
];

// Archetypes: each boosts its own category by 10%.
export const TYPES = {
  SS: { name: 'Sharpshooter', boost: 'tpm' },
  RP: { name: 'Rim Protector', boost: 'blk' },
  FG: { name: 'Floor General', boost: 'ast' },
  SL: { name: 'Slasher', boost: 'ftm' },
  LD: { name: 'Lockdown', boost: 'stl' },
};
// Counters between paired slots: `by` cuts the matching `vs` card's stat by 10%.
export const COUNTERS = [
  { by: 'LD', vs: 'SS', cut: 'tpm', text: 'Lockdown cuts a Sharpshooter’s threes' },
  { by: 'RP', vs: 'SL', cut: 'fgm', text: 'Rim Protector cuts a Slasher’s FG%' },
  { by: 'SL', vs: 'RP', cut: 'blk', text: 'Slasher cuts a Rim Protector’s blocks' },
  { by: 'FG', vs: 'LD', cut: 'stl', text: 'Floor General cuts a Lockdown’s steals' },
];
// Team combos.
export const SYNERGIES = [
  { id: 'spacing', name: 'Spacing', need: { SS: 2, FG: 1 }, stats: ['ast'], bonus: 0.08, text: '2 Sharpshooters + a Floor General: +8% assists' },
  { id: 'towers', name: 'Twin Towers', need: { RP: 2 }, stats: ['reb'], bonus: 0.08, text: '2 Rim Protectors: +8% rebounds' },
  { id: 'wall', name: 'Defensive Wall', need: { LD: 1, RP: 1 }, stats: ['stl', 'blk'], bonus: 0.05, text: 'Lockdown + Rim Protector: +5% steals and blocks' },
];
export const RARITY = {
  common: { name: 'Common', bonus: 0 },
  rare: { name: 'Rare', bonus: 0.03 },
  epic: { name: 'Epic', bonus: 0.06 },
  legendary: { name: 'Legendary', bonus: 0.10 },
};
const BOOST = 0.10, COUNTER = 0.10, STACK_CAP = 0.25;
const COUNTING = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fgm', 'fga', 'ftm', 'to'];

export const synergiesOf = slots => {
  const n = {};
  for (const s of slots) for (const t of s.types || []) n[t] = (n[t] || 0) + 1;
  return SYNERGIES.filter(sy => Object.entries(sy.need).every(([t, k]) => (n[t] || 0) >= k));
};
// Counters active on slot pair i: what `mine` does to `theirs`.
export const countersOn = (mine, theirs) => COUNTERS.filter(c => (mine?.types || []).includes(c.by) && (theirs?.types || []).includes(c.vs));

// Category totals for one side. slots[i] = { id, rarity, types }, facing opp[i].
export function sideTotals(slots, opp, results) {
  const t = Object.fromEntries(COUNTING.map(k => [k, 0]));
  let fp = 0;
  slots.forEach((s, i) => {
    const L = results[s.id];
    if (!L) return;
    fp += fpOf(L);
    const cuts = countersOn(opp[i], s).map(c => c.cut);
    for (const k of COUNTING) {
      const v = L[STAT[k]] || 0;
      if (k === 'fga') { t.fga += v; continue; }
      // Rarity and archetype bonuses stack, capped at +25%.
      const bonus = Math.min(STACK_CAP, (RARITY[s.rarity]?.bonus || 0) + ((s.types || []).some(x => TYPES[x]?.boost === k) ? BOOST : 0));
      let mult = k === 'to' ? 1 - bonus : 1 + bonus;
      if (cuts.includes(k)) mult *= 1 - COUNTER;
      // A booster card lifts one stat (or all of them) for this game, on top of the capped bonuses.
      const bo = s.boost;
      if (bo && (bo.stat === k || bo.stat === 'all')) mult *= k === 'to' ? 1 - bo.pct : 1 + bo.pct;
      t[k] += v * mult;
    }
  });
  for (const sy of synergiesOf(slots)) for (const k of sy.stats) t[k] *= 1 + sy.bonus;
  t.fgp = t.fga ? (t.fgm / t.fga) * 100 : 0;
  return { t, fp: Math.round(fp * 10) / 10 };
}

// The result from each side's category totals ({ t, fp }). Equal category wins fall back to fantasy points.
export function decide(A, B) {
  let winsA = 0, winsB = 0;
  const cats = CATS.map(c => {
    const va = A.t[c.key], vb = B.t[c.key];
    const d = Math.round((va - vb) * 1000) / 1000;
    const w = d === 0 ? null : (c.low ? d < 0 : d > 0) ? 0 : 1;
    if (w === 0) winsA++; else if (w === 1) winsB++;
    return { key: c.key, a: Math.round(va * 10) / 10, b: Math.round(vb * 10) / 10, w };
  });
  let winner = winsA > winsB ? 0 : winsB > winsA ? 1 : A.fp > B.fp ? 0 : B.fp > A.fp ? 1 : null;
  return { cats, wins: [winsA, winsB], fp: [A.fp, B.fp], winner, tiebreak: winsA === winsB && winner !== null };
}
// One night between two lineups.
export const battle = (a, b, results) => decide(sideTotals(a, b || [], results), sideTotals(b || [], a, results));

// Adds nightly totals into one week. A null is a night without a lineup.
export function addTotals(list) {
  const t = Object.fromEntries(COUNTING.map(k => [k, 0]));
  let fp = 0;
  for (const n of list) {
    if (!n) continue;
    for (const k of COUNTING) t[k] += n.t[k] || 0;
    fp += n.fp || 0;
  }
  t.fgp = t.fga ? (t.fgm / t.fga) * 100 : 0;
  return { t, fp: Math.round(fp * 10) / 10 };
}
// A week's result so far from a matchup's stored nights: { <date>: { sides: [{ slots, tot }, { slots, tot }] } }.
export function weekResult(nights) {
  const list = Object.values(nights || {});
  return decide(addTotals(list.map(n => n.sides?.[0]?.tot)), addTotals(list.map(n => n.sides?.[1]?.tot)));
}

// Weeks run Monday to Sunday and are named by their Monday (YYYYMMDD, US Eastern game dates).
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const utc = (date, plus = 0) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + plus));
export function weekOf(date) {
  const d = utc(date);
  return ymd(utc(date, -((d.getUTCDay() + 6) % 7)));
}
export const weekDates = week => Array.from({ length: 7 }, (_, i) => ymd(utc(week, i)));

/* ---------- Archetype assignment ---------- */
// Season sums per player: [games, fp, min, pts, reb, ast, stl, blk, to, threes, fgm, fga, ftm]
export const SEASON = { n: 0, fp: 1, min: 2, pts: 3, reb: 4, ast: 5, stl: 6, blk: 7, to: 8, tpm: 9, fgm: 10, fga: 11, ftm: 12 };

// Each player's strongest type from season per-game stats, ranked against regular rotation players.
// Elite players strong in two types carry a hybrid.
export function assignTypes(season, pos = {}) {
  const per = Object.entries(season).filter(([, s]) => s[SEASON.n] > 0).map(([id, s]) => {
    const n = s[SEASON.n], g = k => s[SEASON[k]] / n;
    return { id, n, min: g('min'), tpm: g('tpm'), blk: g('blk'), reb: g('reb'), ast: g('ast'), stl: g('stl'), pts: g('pts'), ftm: g('ftm'),
      atr: g('ast') / Math.max(0.5, g('to')), fgp: s[SEASON.fga] >= 3 * n ? s[SEASON.fgm] / s[SEASON.fga] : 0 };
  });
  const ref = per.filter(p => p.n >= 3 && p.min >= 12);
  const sorted = {};
  const pct = (k, v) => {
    const arr = sorted[k] || (sorted[k] = ref.map(p => p[k]).sort((x, y) => x - y));
    if (!arr.length) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
    return lo / arr.length;
  };
  const out = {};
  for (const p of per) {
    const score = {
      SS: pct('tpm', p.tpm),
      RP: (pct('blk', p.blk) + pct('reb', p.reb)) / 2,
      FG: (2 * pct('ast', p.ast) + pct('atr', p.atr)) / 3,
      SL: (2 * pct('pts', p.pts) + 2 * pct('ftm', p.ftm) + pct('fgp', p.fgp)) / 5,
      LD: pct('stl', p.stl),
    };
    const [first, second] = Object.entries(score).sort((x, y) => y[1] - x[1]);
    out[p.id] = first[1] >= 0.9 && second[1] >= 0.9 ? [first[0], second[0]] : [first[0]];
  }
  // Players without games yet get the usual type for their position.
  for (const [id, ps] of Object.entries(pos)) if (!out[id]) out[id] = [ps === 'C' ? 'RP' : ps === 'G' ? 'FG' : 'SL'];
  return out;
}
