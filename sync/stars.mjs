// Team of the Week: once a week's games are all final, the six best players (2 G, 2 F, 1 C and the best of the
// rest as the sixth man) by fantasy points over Monday to Sunday become that week's Weekly Stars. Each one's bonus
// category is the stat where his week stood furthest above his season average. They go into packs the following
// week (stored on meta/roster as `stars`, which the page and the pack opener already read).
import { STAT, fpOf, weekDates } from './battle.mjs';

// Categories a Weekly Star can be picked for, with how much a player's nightly number typically swings in each, so a
// jump of 6 points and a jump of 1 block count about the same. The standout is the stat his week beat his season
// average by the most swings. Season averages are roster `s`: [pts, reb, ast, stl, blk, 3PM, FG%, ftm, to].
const PICKS = [['pts', 0, 6], ['reb', 1, 3], ['ast', 2, 2.5], ['stl', 3, 1], ['blk', 4, 1], ['tpm', 5, 1.4], ['ftm', 7, 2.5]];
const LABEL = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', tpm: '3PM', ftm: 'FTM' };
// The Monday after a week (YYYYMMDD).
const next = week => { const d = weekDates(week)[6]; return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + 1)).toISOString().slice(0, 10).replace(/-/g, ''); };
const md = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

// Returns null until every game night of the week is final.
export async function teamOfWeek(db, week, roster) {
  const days = (await Promise.all(weekDates(week).map(d => db.read('days/' + d)))).filter(Boolean);
  if (!days.length || days.some(d => !d.final)) return null;
  const info = new Map((roster?.players || []).map(p => [p.id, p]));
  const tot = new Map();
  for (const d of days) {
    const opp = new Map((d.players || []).map(p => [p.id, p.opp || '']));
    for (const [pid, line] of Object.entries(d.results || {})) {
      if (!info.has(pid) || !line?.[STAT.min]) continue;
      const t = tot.get(pid) || { pid, sum: Array(11).fill(0), games: 0, fp: 0, best: null };
      line.forEach((v, i) => { t.sum[i] += v || 0; });
      const f = fpOf(line);
      t.games++; t.fp += f;
      if (!t.best || f > t.best.fp) t.best = { fp: f, date: d.date, opp: opp.get(pid), line };
      tot.set(pid, t);
    }
  }
  const ranked = [...tot.values()].sort((a, b) => b.fp - a.fp);
  const team = [], taken = new Set();
  const take = (slot, ok) => { const t = ranked.find(x => !taken.has(x.pid) && ok(info.get(x.pid).pos)); if (t) { taken.add(t.pid); team.push({ ...t, slot }); } };
  take('G', p => p === 'G'); take('G', p => p === 'G'); take('F', p => p === 'F'); take('F', p => p === 'F'); take('C', p => p === 'C'); take('UTIL', () => true);
  return {
    week, packWeek: next(week),
    players: team.map(t => {
      const p = info.get(t.pid), pg = i => t.sum[i] / t.games;
      const [stat] = PICKS.map(([k, si, swing]) => [k, (pg(STAT[k]) - (p.s?.[si] || 0)) / swing]).sort((a, b) => b[1] - a[1])[0];
      const b = t.best.line;
      return {
        pid: t.pid, name: p.name, team: p.team, pos: p.pos, slot: t.slot, games: t.games,
        fp: Math.round(t.fp * 10) / 10, fpg: Math.round(t.fp / t.games * 10) / 10,
        stat, statPg: Math.round(pg(STAT[stat]) * 10) / 10,
        caption: `${b[STAT.pts]} PTS · ${b[STAT.reb]} REB · ${b[STAT.ast]} AST ${t.best.opp} · ${md(t.best.date)}`.replace(/\s+/g, ' ').trim(),
        label: LABEL[stat],
      };
    }),
  };
}
