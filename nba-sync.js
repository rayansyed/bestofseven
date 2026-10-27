// Best of 7 (NBA) data sync.
// Pulls ESPN's public NBA scoreboard, rosters and box scores, and writes one JSON
// document per game day to ./out/<YYYYMMDD>.json, shaped for the artifact's `days` collection.
// Usage: node nba-sync.js [YYYYMMDD ...]   (default: yesterday, today, tomorrow in US Eastern time)
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CACHE = path.join(DIR, 'cache');
const OUT = path.join(DIR, 'out');
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
for (const d of [CACHE, OUT]) fs.mkdirSync(d, { recursive: true });

const get = url => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': 'best-of-7-sync' } }, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode !== 200) return reject(new Error(res.statusCode + ' ' + url));
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  }).on('error', reject);
});

// Cached forever once a scoreboard/box score is final; refetched otherwise.
async function cached(name, url, isFinal) {
  const file = path.join(CACHE, name + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = await get(url);
  if (isFinal(data)) fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

const DONE = new Set(['STATUS_FINAL', 'STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_FORFEIT']);
const etDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace(/-/g, '');
};
const fp = s => s[1] + 1.2 * s[2] + 1.5 * s[3] + 3 * s[4] + 3 * s[5] - s[6];
// Salary is proportional to fantasy points per game (about 4.5 pts per 1,000 credits at every price),
// so stars aren't automatically the best value. Floor 3,000, ceiling 12,000.
const salary = avg => Math.round(Math.min(12000, Math.max(3000, avg * 222)) / 100) * 100;
const normPos = a => { a = (a || 'F').toUpperCase(); return a.startsWith('C') ? 'C' : a.includes('G') ? 'G' : 'F'; };

const scoreboard = date => cached('sb-' + date, `${API}/scoreboard?dates=${date}`,
  sb => date < etDate(0) && sb.events.every(e => DONE.has(e.status.type.name)));
const summary = id => cached('box-' + id, `${API}/summary?event=${id}`,
  b => DONE.has(b.header?.competitions?.[0]?.status?.type?.name));

// Box score lines: { athleteId: { name, team, line:[min,pts,reb,ast,stl,blk,to] } }
function boxLines(box) {
  const out = {};
  for (const t of box.boxscore?.players || []) {
    const st = t.statistics?.[0];
    if (!st) continue;
    const L = st.labels || st.names;
    const ix = k => L.indexOf(k);
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats || !a.stats.length) continue;
      const n = k => { const v = parseFloat(a.stats[ix(k)]); return isNaN(v) ? 0 : v; };
      out[a.athlete.id] = { name: a.athlete.displayName, team: t.team.abbreviation, line: [n('MIN'), n('PTS'), n('REB'), n('AST'), n('STL'), n('BLK'), n('TO')] };
    }
  }
  return out;
}

// Season-to-date fantasy averages from every regular-season game strictly before `date`.
async function averages(date, calendar) {
  const sums = {};
  for (const d of calendar) {
    if (d >= date) break;
    const sb = await scoreboard(d);
    for (const e of sb.events) {
      if (e.season?.type !== 2 || e.status.type.name !== 'STATUS_FINAL') continue;
      const lines = boxLines(await summary(e.id));
      for (const [id, x] of Object.entries(lines)) {
        const s = sums[id] || (sums[id] = { n: 0, fp: 0 });
        s.n++; s.fp += fp(x.line);
      }
    }
  }
  return sums;
}

async function buildDay(date, calendar) {
  const sb = await scoreboard(date);
  const events = sb.events.filter(e => e.season?.type === 2 || e.season?.type === 3);
  const outFile = path.join(OUT, date + '.json');
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;
  const games = events.map(e => {
    const c = e.competitions[0];
    const away = c.competitors.find(x => x.homeAway === 'away'), home = c.competitors.find(x => x.homeAway === 'home');
    return { id: e.id, away: away.team.abbreviation, home: home.team.abbreviation, tip: e.date, status: e.status.type.name, detail: e.status.type.shortDetail, awayScore: +away.score || 0, homeScore: +home.score || 0, awayId: away.team.id, homeId: home.team.id };
  });
  if (!games.length) return null;
  const lockAt = games.map(g => g.tip).sort()[0];
  const locked = Date.now() >= Date.parse(lockAt);

  // The player pool and salaries freeze at lock so lineups keep the prices they were built with.
  let players;
  if (locked && prev && prev.players) players = prev.players;
  else {
    const avg = await averages(date, calendar);
    players = [];
    for (const g of games) {
      for (const [teamId, team, opp, home] of [[g.awayId, g.away, g.home, false], [g.homeId, g.home, g.away, true]]) {
        const ro = await get(`${API}/teams/${teamId}/roster`);
        for (const a of ro.athletes || []) {
          const s = avg[a.id];
          const av = s ? Math.round(s.fp / s.n * 10) / 10 : 0;
          const inj = a.injuries?.[0]?.status || '';
          players.push({ id: a.id, name: a.displayName, team, opp: (home ? 'vs ' : '@ ') + opp, pos: normPos(a.position?.abbreviation), avg: av, gp: s ? s.n : 0, sal: salary(av), status: inj });
        }
      }
    }
  }

  const results = {};
  for (const g of games) {
    if (g.status === 'STATUS_SCHEDULED') continue;
    const lines = boxLines(await summary(g.id));
    for (const [id, x] of Object.entries(lines)) results[id] = x.line;
  }
  const final = games.every(g => DONE.has(g.status));
  const doc = { date, lockAt, final, games: games.map(({ awayId, homeId, ...g }) => g), players, results, updatedAt: new Date().toISOString() };
  fs.writeFileSync(outFile, JSON.stringify(doc));
  return doc;
}

(async () => {
  const dates = process.argv.slice(2).length ? process.argv.slice(2) : [etDate(-1), etDate(0), etDate(1)];
  const first = await scoreboard(dates[0]);
  const calendar = (first.leagues[0].calendar || []).map(c => {
    const d = new Date(c);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d.getTime() + 12 * 36e5)).replace(/-/g, '');
  });
  for (const date of dates) {
    const doc = await buildDay(date, calendar);
    if (!doc) { console.log(`${date}: no NBA games`); continue; }
    const live = doc.games.filter(g => g.status !== 'STATUS_SCHEDULED').length;
    console.log(`${date}: ${doc.games.length} games, ${doc.players.length} players, ${live} started, final=${doc.final} -> ${path.join(OUT, date + '.json')}`);
  }
})().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });
