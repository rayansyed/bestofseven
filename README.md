# Best of 7 · NBA

Ranked NBA fantasy you can play any night. Draft six real players (2 G, 2 F, 1 C, 1 UTIL) on a 16★ budget and name a captain. When lineups lock at the first tip-off, you're placed in a group of 10 players at your rank, with computer lineups filling empty seats. Real box scores decide the group. Finishing high earns rank points, and every 100 points moves you up a tier: Bronze → Silver → Gold → Platinum → Diamond → Elite.

## Rules
| | |
|---|---|
| Scoring | point 1 · rebound 1.2 · assist 1.5 · steal 3 · block 3 · turnover −1 |
| Star ratings | every player is 1–5★ by fantasy points per game this season: 45+ = 5★, 35–44.9 = 4★, 25–34.9 = 3★, 15–24.9 = 2★, under 15 = 1★. Ratings freeze at the first tip-off. |
| Budget | your six players' stars must add up to **16★ or less**, with **at most one 5★ player** |
| Captain | scores 1.5× and **costs one extra star** |
| Rank points | 1st +30 · 2nd–3rd +20 · 4th–5th +5 · 6th–7th −5 · 8th–10th −15 |
| Tiers | 100 RP each. You can't drop out of a tier the night after reaching it. RP never goes below 0. |
| Ties | best single player score, then whoever entered first |
| Skipping | free. Play only the nights you want. |

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The game. A static page hosted on Vercel. |
| `config.js` | Your Firebase web config (public values). |
| `firestore.rules` | Who can read and write what. Lineups lock at tip-off, and only the sync can change ranks. |
| `sync/nba-sync.mjs` | Pulls ESPN's NBA scoreboard, rosters, injuries and box scores into Firestore, then runs the ranked steps. |
| `sync/ranked.mjs` | Forms groups at lock (computer lineups fill seats) and scores finished nights into rank points. |
| `sync/game.mjs` | Game rules shared by the sync: star ratings, lineup checks, scoring, the computer's lineup builder. `index.html` has a copy of the lineup rules, so keep the two in step. |
| `.github/workflows/main.yml` | Runs the sync from GitHub Actions on a schedule. |

Firestore collections:
- `days/<YYYYMMDD>`: a night's games, player pool, star ratings, injury tags and box scores (written by the sync)
- `days/<YYYYMMDD>/groups/<tier>-<n>`: a group's ten lineups, and the final order (written by the sync)
- `entries/<YYYYMMDD>_<uid>`: a player's lineup for a night (written by the player until tip-off). The sync adds the group, finish and rank-point change.
- `users/<uid>`: display name (written by the player), plus RP, tier, nights and wins (written by the sync)
- `meta/averages`: running season fantasy averages (written by the sync)

## A night, start to finish
1. **Day before:** the sync posts the slate with star ratings.
2. **Until tip-off:** players draft. A complete lineup is an entry, and emptying a slot withdraws it.
3. **First tip-off:** Firestore refuses lineup edits. On the next sync (within 30 minutes), entries are checked. Legal ones are grouped by tier in tens, sorted by RP, and computer lineups fill the empty seats. An illegal lineup (over the star budget, two 5★ players, wrong positions) is marked invalid and doesn't count.
4. **During games:** an open page reads live scores straight from ESPN every minute, so the group board stays current even when the sync is late. These numbers are for display only.
5. **All games final:** on its next run, the sync ranks each group and writes everyone's finish, rank-point change and new tier.

## Setup (about 15 minutes)

### 1. Create a Firebase project
Go to https://console.firebase.google.com, click **Add project**, and follow the prompts. Analytics isn't needed, and the free Spark plan is enough.

### 2. Turn on email sign-in
**Build → Authentication → Get started → Sign-in method → Email/Password**. Enable it, then also enable **Email link (passwordless sign-in)**, and save.
Then **Authentication → Settings → Authorized domains → Add domain**, and add your Vercel domain (for example `bestofseven.vercel.app`).

### 3. Create the database and its rules
**Build → Firestore Database → Create database**. Pick a location and start in **production mode**. Open the **Rules** tab, replace everything with `firestore.rules`, and click **Publish**. Republish it whenever `firestore.rules` changes.

### 4. Add your web config
**Project settings → General → Your apps → Web (`</>`)**. Register an app, copy the `firebaseConfig` values into `config.js`, and commit.

### 5. Give the sync access
**Project settings → Service accounts → Generate new private key**. **Don't commit the file.** In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `FIREBASE_SERVICE_ACCOUNT`, paste the entire JSON, and save. Then delete the downloaded file.

### 6. Run the first sync
**Actions → NBA sync → Run workflow**. After that it runs every 30 minutes from 6 PM to 3:30 AM ET, and at 9 AM, 1 PM and 4 PM ET.

### 7. Deploy on Vercel
Import the repo with **Framework preset: Other** and no build command. Open the site, sign in with your email, pick a display name, and enter tonight.

## Notes
- **First leaderboard query:** the leaderboard sorts `users` by `rp`. Firestore indexes single fields automatically, so no setup is needed. If the browser console ever shows a "requires an index" link, click it once.
- **Late schedules:** GitHub treats cron times as best effort and can run them hours late or skip them, especially on free accounts. That delays forming groups and applying rank points, but never changes the results. **Run workflow** catches up immediately.
- **Paused schedules:** GitHub pauses scheduled workflows after 60 days without repo activity. A commit, or **Run workflow**, turns them back on.
- **Testing without Firebase:** `cd sync && DRY_RUN=1 node nba-sync.mjs` writes JSON to `sync/out/`.
- **Data source:** NBA data comes from ESPN's public, unofficial API. If ESPN changes it, the sync may need updating.
