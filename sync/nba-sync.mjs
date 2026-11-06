// Best of 7 (NBA) data sync.
// Pulls ESPN's public NBA scoreboard, rosters and box scores and writes one Firestore document per
// game day to `days/<YYYYMMDD>`, plus season stats (`meta/season`), monthly archetypes (`meta/types`) and
// the league roster for starter packs (`meta/roster`). After a slate locks it adds each lineup to
// its owner's weekly matchup; each final night's stats join the week, and finished weeks update ranks.
// Runs from GitHub Actions (see .github/workflows/nba-sync.yml).
//
// Env:
//   FIREBASE_SERVICE_ACCOUNT  the service-account JSON (a GitHub secret)
//   DRY_RUN=1                 write to ./out/*.json instead of Firestore (for local testing)
// Usage: node nba-sync.mjs [YYYYMMDD ...]   (default: yesterday, today, tomorrow in US Eastern time)
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starsOf } from './game.mjs';
import { lockNight, scoreNight, scoreWeeks, applySkips, bestSquads } from './ranked.mjs';
import { teamOfWeek } from './stars.mjs';
import { weekOf } from './battle.mjs';
import * as groups from './ranked-groups.mjs';
import { assignTypes, SEASON } from './battle.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const DRY = !!process.env.DRY_RUN;
const DONE = new Set(['STATUS_FINAL', 'STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_FORFEIT']);

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

const etDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
const fp = s => s[1] + 1.2 * s[2] + 1.5 * s[3] + 3 * s[4] + 3 * s[5] - s[6];
const normPos = a => { a = (a || 'F').toUpperCase(); return a.startsWith('C') ? 'C' : a.includes('G') ? 'G' : 'F'; };

/* ---------- Storage: Firestore, or local files in dry-run mode ---------- */
let fsdb = null;
async function store() {
  if (DRY) {
    const out = path.join(DIR, 'out');
    fs.mkdirSync(out, { recursive: true });
    const file = p => path.join(out, p.split('/').join('__') + '.json');
    const read = async p => fs.existsSync(file(p)) ? JSON.parse(fs.readFileSync(file(p), 'utf8')) : null;
    const write = async (p, data, merge) => fs.writeFileSync(file(p), JSON.stringify(merge ? { ...(await read(p)), ...data } : data));
    // Documents directly inside a collection path.
    const list = async coll => {
      const prefix = coll.split('/').join('__') + '__', depth = coll.split('/').length + 1;
      return fs.readdirSync(out).filter(f => f.startsWith(prefix) && f.slice(0, -5).split('__').length === depth)
        .map(f => ({ id: f.slice(prefix.length, -5), data: JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) }));
    };
    return {
      read, write, list,
      query: async (coll, field, value) => (await list(coll)).filter(d => d.data[field] === value),
      // A write with del: true removes the document (a used booster card, for example).
      batch: async writes => { for (const w of writes) w.del ? fs.rmSync(file(w.path), { force: true }) : await write(w.path, w.data, w.merge); },
    };
  }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  fsdb = getFirestore();
  const docs = s => s.docs.map(d => ({ id: d.id, data: d.data() }));
  return {
    read: async p => { const s = await fsdb.doc(p).get(); return s.exists ? s.data() : null; },
    write: async (p, data) => fsdb.doc(p).set(data),
    list: async coll => docs(await fsdb.collection(coll).get()),
    query: async (coll, field, value) => docs(await fsdb.collection(coll).where(field, '==', value).get()),
    // Firestore batches hold at most 500 writes.
    batch: async writes => {
      for (let i = 0; i < writes.length; i += 400) {
        const b = fsdb.batch();
        for (const w of writes.slice(i, i + 400)) w.del ? b.delete(fsdb.doc(w.path)) : b.set(fsdb.doc(w.path), w.data, { merge: !!w.merge });
        await b.commit();
      }
    },
  };
}

/* ---------- ESPN parsing ---------- */
// Box score lines: { athleteId: [min, pts, reb, ast, stl, blk, to, threes, fgm, fga, ftm] }
function boxLines(box) {
  const out = {};
  for (const t of box.boxscore?.players || []) {
    const st = t.statistics?.[0];
    if (!st) continue;
    const L = st.labels || st.names;
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats || !a.stats.length) continue;
      const n = k => { const v = parseFloat(a.stats[L.indexOf(k)]); return isNaN(v) ? 0 : v; };
      // Shooting columns read "made-attempted".
      const att = k => { const v = parseFloat(String(a.stats[L.indexOf(k)] || '').split('-')[1]); return isNaN(v) ? 0 : v; };
      out[a.athlete.id] = [n('MIN'), n('PTS'), n('REB'), n('AST'), n('STL'), n('BLK'), n('TO'), n('3PT'), n('FG'), att('FG'), n('FT')];
    }
  }
  return out;
}

function seasonCalendar(sb) {
  // ESPN lists game days as midnight-Pacific timestamps; shift into the day before mapping to Eastern dates.
  return (sb.leagues?.[0]?.calendar || []).map(c => etDate(Date.parse(c) + 12 * 36e5));
}

// Season-to-date sums per player, kept incrementally: `through` is the last game day folded in.
// p[id] = [games, fp, min, pts, reb, ast, stl, blk, to, threes, fgm, fga, ftm]
async function updateSeason(db, calendar, today) {
  const agg = (await db.read('meta/season')) || { through: '', p: {} };
  for (const d of calendar) {
    if (d <= agg.through || d >= today) continue;
    const sb = await get(`${API}/scoreboard?dates=${d}`);
    const events = sb.events.filter(e => e.season?.type === 2);
    if (events.some(e => !DONE.has(e.status.type.name))) break; // not settled yet; try again next run
    for (const e of events) {
      if (e.status.type.name !== 'STATUS_FINAL') continue;
      for (const [id, line] of Object.entries(boxLines(await get(`${API}/summary?event=${e.id}`)))) {
        const t = agg.p[id] || (agg.p[id] = new Array(13).fill(0));
        t[0]++; t[1] = Math.round((t[1] + fp(line)) * 10) / 10;
        for (let k = 0; k < 11; k++) t[2 + k] += line[k] || 0;
      }
    }
    agg.through = d;
    console.log(`season: folded in ${d} (${events.length} games)`);
  }
  await db.write('meta/season', agg);
  return agg;
}
const avgOf = (season, id) => { const t = season.p[id]; return t ? Math.round(t[SEASON.fp] / t[SEASON.n] * 10) / 10 : 0; };

// Archetypes recalculate monthly: a player keeps this month's type, and new players get one when first seen.
async function monthlyTypes(db, season, pos) {
  const month = etDate().slice(0, 6);
  const stored = (await db.read('meta/types')) || {};
  const fresh = assignTypes(season.p, pos);
  const t = stored.month === month ? { ...fresh, ...stored.t } : fresh;
  if (stored.month !== month || Object.keys(t).length !== Object.keys(stored.t || {}).length) {
    await db.write('meta/types', { month, t });
    console.log(`types: ${stored.month === month ? 'added new players' : 'recalculated for ' + month}`);
  }
  return t;
}

// Every active player, for starter packs. Refreshed about once a day.
// Per-game season averages in the nine categories, in battle order: [pts, reb, ast, stl, blk, threes, FG%, ftm, to].
function perGame(season, id) {
  const t = season.p[id], n = t?.[SEASON.n];
  if (!n) return null;
  const g = k => Math.round(t[SEASON[k]] / n * 10) / 10;
  return [g('pts'), g('reb'), g('ast'), g('stl'), g('blk'), g('tpm'), t[SEASON.fga] ? Math.round(t[SEASON.fgm] / t[SEASON.fga] * 1000) / 10 : null, g('ftm'), g('to')];
}

// Every player's team, position, rating, archetypes and per-game averages, for cards and starter packs.
// Team rosters are refetched once a day; ratings and averages are refreshed from the season totals every run.
async function updateRoster(db, season, types) {
  const prev = await db.read('meta/roster');
  const fetchedAt = prev?.fetchedAt || prev?.updatedAt;
  let base = prev?.players;
  if (!base || Date.now() - Date.parse(fetchedAt) >= 20 * 36e5) {
    const teams = (await get(`${API}/teams`)).sports[0].leagues[0].teams.map(x => x.team);
    base = [];
    for (const tm of teams) {
      for (const p of (await get(`${API}/teams/${tm.id}/roster`)).athletes || []) base.push({ id: p.id, name: p.displayName, team: tm.abbreviation, pos: normPos(p.position?.abbreviation) });
    }
    console.log(`roster: fetched ${base.length} players`);
  }
  const players = base.map(({ id, name, team, pos }) => {
    const avg = avgOf(season, id);
    const t = season.p[id], gp = t?.[SEASON.n] || 0;
    // Minutes per game keeps players who barely play out of packs.
    return { id, name, team, pos, avg, gp, mpg: gp ? Math.round(t[SEASON.min] / gp * 10) / 10 : 0, stars: starsOf(avg), types: types[id] || [], s: perGame(season, id) };
  });
  const same = prev && JSON.stringify(prev.players) === JSON.stringify(players);
  const roster = { updatedAt: same ? prev.updatedAt : new Date().toISOString(), fetchedAt: base === prev?.players ? fetchedAt : new Date().toISOString(), players,
    // The current Team of the Week, written separately below; carried across rewrites.
    ...(prev?.stars ? { stars: prev.stars } : {}) };
  if (!same || roster.fetchedAt !== fetchedAt) await db.write('meta/roster', roster);
  return roster;
}

async function buildDay(db, date, season, types) {
  const sb = await get(`${API}/scoreboard?dates=${date}`);
  const events = sb.events.filter(e => e.season?.type === 2 || e.season?.type === 3);
  if (!events.length) return null;
  const prev = await db.read('days/' + date);
  const games = events.map(e => {
    const c = e.competitions[0];
    const away = c.competitors.find(x => x.homeAway === 'away'), home = c.competitors.find(x => x.homeAway === 'home');
    return { id: e.id, away: away.team.abbreviation, home: home.team.abbreviation, tip: e.date, status: e.status.type.name, detail: e.status.type.shortDetail, awayScore: +away.score || 0, homeScore: +home.score || 0, awayId: away.team.id, homeId: home.team.id };
  });
  const lockAt = games.map(g => g.tip).sort()[0];
  const lockMs = Date.parse(lockAt);

  // The player pool and star ratings freeze at lock so lineups keep the costs they were built with.
  let players;
  if (Date.now() >= lockMs && prev?.players) players = prev.players;
  else {
    players = [];
    for (const g of games) {
      for (const [teamId, team, opp, home] of [[g.awayId, g.away, g.home, false], [g.homeId, g.home, g.away, true]]) {
        const ro = await get(`${API}/teams/${teamId}/roster`);
        for (const a of ro.athletes || []) {
          const av = avgOf(season, a.id);
          players.push({ id: a.id, name: a.displayName, team, opp: (home ? 'vs ' : '@ ') + opp, pos: normPos(a.position?.abbreviation), avg: av, gp: season.p[a.id]?.[SEASON.n] || 0, stars: starsOf(av), types: types[a.id] || [], status: a.injuries?.[0]?.status || '' });
        }
      }
    }
  }

  const results = {};
  for (const g of games) {
    if (g.status === 'STATUS_SCHEDULED') continue;
    Object.assign(results, boxLines(await get(`${API}/summary?event=${g.id}`)));
  }
  const doc = { date, lockAt, lockMs, final: games.every(g => DONE.has(g.status)), games: games.map(({ awayId, homeId, ...g }) => g), players, results, updatedAt: new Date().toISOString(),
    // Ranked progress, written by groupNight/scoreNight; carried across rewrites.
    grouped: !!prev?.grouped, scored: !!prev?.scored, mode: prev?.mode || null, groups: prev?.groups || 0, matches: prev?.matches || 0, entrants: prev?.entrants || 0, top3: prev?.top3 || null };
  await db.write('days/' + date, doc);
  return doc;
}

const db = await store();
const now = Date.now();
const dates = process.argv.slice(2).length ? process.argv.slice(2) : [etDate(now - 864e5), etDate(now), etDate(now + 864e5)];
const calendar = seasonCalendar(await get(`${API}/scoreboard?dates=${dates[0]}`));
const season = await updateSeason(db, calendar, etDate(now));
const roster0 = await db.read('meta/roster');
const pos = Object.fromEntries((roster0?.players || []).map(p => [p.id, p.pos]));
const types = await monthlyTypes(db, season, pos);
await updateRoster(db, season, types);
for (const date of dates) {
  const doc = await buildDay(db, date, season, types);
  if (!doc) { console.log(`${date}: no NBA games`); continue; }
  const live = doc.games.filter(g => g.status !== 'STATUS_SCHEDULED').length;
  console.log(`${date}: ${doc.games.length} games, ${doc.players.length} players, ${live} started, final=${doc.final}`);
  if (Date.now() >= doc.lockMs && !doc.grouped) {
    const g = await lockNight(db, doc);
    doc.grouped = true; doc.mode = 'week';
    console.log(`${date}: ${g.entrants} lineups locked into ${g.matches} weekly matchups (${g.created} new)`);
  }
  // Nights grouped before weekly matchups existed (no mode) are scored the old way.
  const battleNight = doc.mode === 'week';
  if (doc.final && doc.grouped && !doc.scored) {
    doc.scored = true;
    const s = battleNight ? await scoreNight(db, doc) : await groups.scoreNight(db, doc);
    const skipped = await applySkips(db, date);
    console.log(`${date}: scored ${s.scored} ${battleNight ? 'matchups' : 'groups'}, ${skipped} players skipped`);
  }
  // Also fills in a night that was scored before this existed.
  if (doc.scored && !doc.top3) {
    const top3 = battleNight ? await bestSquads(db, doc) : await groups.bestSquads(db, doc);
    await db.batch([{ path: 'days/' + date, data: { top3 }, merge: true }]);
    console.log(`${date}: best squads: ${top3.map(s => `${s.name} ${s.total}`).join(', ') || 'none'}`);
  }
}
// Weeks end on Sunday: decide every matchup whose week is over and fully scored.
const weeks = await scoreWeeks(db, etDate(now));
if (weeks) console.log(`weeks: decided ${weeks} matchups`);
// Last week's Team of the Week, once all its games are final: they go into packs this week.
const lastWeek = weekOf(etDate(now - 7 * 864e5)), rosterNow = await db.read('meta/roster');
if (rosterNow && rosterNow.stars?.week !== lastWeek) {
  const stars = await teamOfWeek(db, lastWeek, rosterNow);
  if (stars?.players.length) {
    await db.batch([{ path: 'meta/roster', data: { stars }, merge: true }]);
    console.log(`stars: team of the week ${lastWeek}: ${stars.players.map(p => `${p.name} (${p.slot}, ${p.fp} FP, +${p.label})`).join(', ')}`);
  }
}
process.exit(0);
