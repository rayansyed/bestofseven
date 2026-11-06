# Best of 7 · NBA

An NBA card battler played in weekly head-to-head matchups. Collect player cards, and every game night set a six-card lineup (2 G, 2 F, 1 C, 1 UTIL) from the cards you own. Each week, Monday to Sunday, you face one opponent at your rank. Every night's real box scores add up across nine stat categories, so as the week goes on you can pick cards to chase the categories you're losing. Win more categories by Sunday to win the week and earn rank points; every 100 points moves you up a tier: Bronze → Silver → Gold → Platinum → Diamond → Elite.

## Rules
| | |
|---|---|
| Cards | new players open **3 free starter packs** of 5 cards (2 G, 2 F, 1 C each), all Common, with no 4★ or 5★ players. The first pack favours players with a game in the next two days. Packs are opened on the server (`api/packs.js`), so cards can't be made up in the browser. |
| Lineup | six slots from cards you own whose players have a game that night, in **any combination**: there is no star budget. A slot can stay empty when none of your cards fits it; it scores nothing. |
| Star ratings | shown on every card as a guide to how good the player is: 1–5★ by fantasy points per game this season, 45+ = 5★, 35–44.9 = 4★, 25–34.9 = 3★, 15–24.9 = 2★, under 15 = 1★. Computer opponents keep to a 16★ budget so they stay beatable with starter cards. |
| Weekly matchups | weeks run Monday to Sunday. The first night you enter in a week pairs you, at that night's lock, with another new entrant at your rank (within your tier first, then across tiers); a computer takes an odd seat and sets a fresh lineup every night. You keep that opponent until Sunday. |
| Nights | each game night you set a new lineup, locked at that night's first tip-off. Each slot faces the same slot on the other side that night. A night you skip adds nothing to your week. |
| Categories | points, rebounds, assists, steals, blocks, threes made, FG% (made ÷ attempted over the week), free throws made, turnovers (fewer wins), each added up over the week. Most categories wins the week; a tie goes to the most duels won, then to the week's total fantasy points (point 1 · rebound 1.2 · assist 1.5 · steal 3 · block 3 · turnover −1). |
| Duels | every night the two cards in the same spot (G vs G, C vs C, …) duel: the higher fantasy score wins. A player without a box score, or an empty spot, scores 0; a level score is nobody's. Duels add up over the week as the first tiebreaker. |
| Archetypes | +10% to one category: Sharpshooter (threes), Rim Protector (blocks), Floor General (assists), Slasher (free throws made), Lockdown (steals). Set monthly from season stats; elite players can carry two. |
| Counters | between facing slots, −10%: Lockdown cuts a Sharpshooter's threes · Rim Protector cuts a Slasher's FG% · Slasher cuts a Rim Protector's blocks · Floor General cuts a Lockdown's steals |
| Combos | Spacing (2 Sharpshooters + a Floor General): +8% assists · Twin Towers (2 Rim Protectors): +8% rebounds · Defensive Wall (Lockdown + Rim Protector): +5% steals and blocks |
| Rarity | Common +0 · Rare +3% · Epic +6% · Legendary +10% to all of a card's stats (and fewer turnovers). Rarity and archetype stack up to +25%. |
| Coins | earned against your weekly opponent: win the night **+20** · each category you win that night **+2** · each duel won **+5** · sweep all six duels **+15** · win the week **+100**. A night your opponent sits out counts as zeros on their side. Spent on packs. |
| Packs | the Packs page. **Daily:** free once a day (US Eastern), 3 players with a game on the next slate plus a booster. **Standard:** 150 coins, 4 players plus a booster. **Premium:** 400 coins, 5 players with at least one Rare or better, plus 2 boosters. Better packs have better rarity odds, and rarer cards are better players: Common 1–2★, Rare 2–3★, Epic 3–4★, Legendary 5★ only. Players averaging under 12 minutes a game never turn up in packs (starter packs included). Packs can hold duplicates. |
| Weekly Stars | after Sunday's games the sync picks the **Team of the Week**: the most fantasy points over Monday to Sunday at G, G, F, F, C, plus the best of the rest as sixth man. Each gets a **Weekly Star** card with its own design and a bonus of **+15%** on the stat where his week stood out most against his season average, plus **+6%** on everything (inside the 25% cap). They're in packs the following week only (Premium 1 in 4, Standard 1 in 12, Daily 1 in 30), shown on the Packs page, then retired. A Weekly Star is the copy that plays when you own one. Sells for 300. |
| Card levels | spend duplicates to level up a player's card instead of selling them: each level uses **2** duplicate copies and adds **+5%** to a category you pick (any of the nine; Fewer TO cuts turnovers), up to **Level 3**. The boost counts inside the +25% per-stat cap with rarity and archetype. Levels belong to your best copy of the player and move onto a rarer copy at the next level-up. Done in the player's profile; the card shows "Level 2" and marks the boosted stats. |
| Selling | sell any card for coins: Common 10 · Rare 30 · Epic 75 · Legendary 200. The Packs page lists your duplicates (your best card of each player is kept). You can’t sell your last card of a player who’s in one of your lineups for today or later. |
| Boosters | booster cards lift one stat for one game, such as +15% points, +20% blocks or −20% turnovers, or every stat by 8%. Put one on a card from that spot’s picker before tip-off. It applies to that night’s game on top of the +25% cap and is used up when the night locks. |
| Rank points | win the week **+40** · lose it **−20** · tie 0. Paid once all of the week's games are final. |
| Tiers | 100 RP each. You can't drop out of a tier the week after reaching it. RP never goes below 0. |
| Skipping | once you have played a night, each game night you skip costs **3 RP** and resets your streak. It can never drop you out of your tier, and nights with no NBA games don't count. |
| Entry streak | enter every game night to build a streak, win or lose. Nights with no NBA games don't break it, and an invalid entry neither grows nor breaks it. |
| Streak rewards | 3 nights: +3 RP · 5 nights: +5 RP · every 7 nights: +7 RP · every 14 nights: a **Streak Saver** · 30 nights: a leaderboard badge. Paid when the night is scored. |
| Streak Saver | used automatically on your next skip: no RP lost, and the streak holds. |

Nights played in groups of 10 before battles (with a captain) are still shown and scored the old way.

## Profiles
The Profile tab holds a player's picture, stats and badges. Pictures are center-cropped in the browser to 128×128 and saved on the player's own record, which keeps the site on Firebase's free plan and removes photo metadata such as location. Badges are worked out from stats only the sync can write, so they can't be self-awarded. **NBA moment** badges (such as Blocked by James: LeBron records a block in your lineup) are checked against each night's real box scores when it's scored, in `momentBadges` in `sync/game.mjs`. **Pictures aren't moderated**, and they're public.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The game. A static page hosted on Vercel. |
| `config.js` | Your Firebase web config (public values). |
| `firestore.rules` | Who can read and write what. Lineups lock at tip-off, and only the server can create cards or change ranks. |
| `api/packs.js` | A Vercel function that opens a player's starter, daily and shop packs and charges coins. `api/_packs.js` holds the packs, odds, boosters and sell values. |
| `api/sell.js` | A Vercel function that sells cards for coins. |
| `api/level.js` | A Vercel function that levels up a card, using up duplicate copies. |
| `sync/stars.mjs` | Picks the Team of the Week and each star's bonus stat (stored on `meta/roster` as `stars`). |
| `tow/<week>/<playerId>.jpg` | Action photos for Weekly Star cards (`<week>` is that week's Monday, YYYYMMDD; the player id is ESPN's). A card without one uses the player's headshot. |
| `package.json` | The function's one dependency, `firebase-admin`. |
| `sync/nba-sync.mjs` | Pulls ESPN's NBA scoreboard, rosters, injuries and box scores into Firestore, then runs the ranked steps. |
| `sync/ranked.mjs` | At each lock, adds every lineup to its owner's weekly matchup and pairs new entrants (a computer takes an odd seat). Adds each final night to the week, and decides finished weeks into rank points. `sync/ranked-groups.mjs` scores nights from before battles. |
| `sync/battle.mjs` | Battle rules: categories, archetypes, counters, combos, rarity, and the monthly archetype assignment. `index.html` has a copy for the live board, so keep the two in step. |
| `sync/game.mjs` | Game rules shared by the sync: star ratings, lineup checks, scoring, the computer's lineup builder. `index.html` has a copy of the lineup rules, so keep the two in step. |
| `.github/workflows/main.yml` | Runs the sync from GitHub Actions on a schedule. |

Firestore collections:
- `days/<YYYYMMDD>`: a night's best three squads, games, player pool (with star ratings and archetypes), injury tags and box scores (written by the sync)
- `matches/<week>_m<n>`: a weekly matchup (`week` is its Monday): both players, each night's two lineups with every card's rarity and archetypes, each night's category totals, and the week's result (written by the sync)
- `days/<YYYYMMDD>/groups/<tier>-<n>`: groups of ten from before battles
- `entries/<YYYYMMDD>_<uid>`: a player's lineup for a night (written by the player until tip-off). Boosters ride along as `boosts` (slot → booster). The sync adds the matchup, the night's result and coins, and rank-point change.
- `users/<uid>`: display name, picture and featured badge (written by the player), plus RP, tier, record, streak, personal bests, coins, today's daily pack and starter packs opened (written by the server)
- `users/<uid>/cards/<id>`: the player's cards, one document per copy (written by the server only)
- `users/<uid>/boosters/<id>`: the player's unused booster cards (created by `/api/packs`, used up by the sync at lock)
- `meta/season`: running season stat totals · `meta/types`: this month's archetypes · `meta/roster`: every player's team, position, rating, archetypes and per-game averages in the nine categories (shown on cards), read by the page and the pack opener. Team rosters are refetched daily; ratings and averages refresh every run (written by the sync)

## A week, start to finish
1. **Day before:** the sync posts the slate with star ratings and archetypes.
2. **Until tip-off:** players set lineups from their cards. A lineup is entered once every slot one of your cards could fill is filled; emptying such a slot withdraws it.
3. **First tip-off:** Firestore refuses lineup edits. On the next sync (within 30 minutes), entries are checked, each lineup joins its owner's matchup for the week, and anyone without one is paired. An illegal lineup (wrong positions, a duplicate player, a card you don't own) is marked invalid and doesn't count.
4. **During games:** an open page reads live scores straight from ESPN every minute and works out the week as it goes, so the scoreboard stays current even when the sync is late. These numbers are for display only.
5. **A night's games final:** on its next run, the sync stores that night's category totals in each matchup and pays streaks and moments.
6. **After Sunday:** once every game night of the week is final, the sync decides each matchup on the week's totals and writes everyone's result, rank-point change and new tier.

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
Import the repo with **Framework preset: Other** and no build command.

### 8. Let Vercel open card packs
In Vercel, open the project's **Settings → Environment Variables**, add `FIREBASE_SERVICE_ACCOUNT` with the same service-account JSON as the GitHub secret (make a new key in step 5 if you deleted it), and redeploy. Then open the site, sign in with your email, pick a display name, open your starter packs and enter tonight.

## Notes
- **Gifting packs:** in the Firebase console, open `users/<uid>` and add a map field `giftPacks` with a number for each pack type to give: `daily`, `standard` or `premium` (for example `premium: 1`). The player sees them at the top of the Packs page with a count on the Packs tab, and opens them free; gifts don't use coins or the daily pack. Each one opened lowers its count. To give starter packs again, set `starterPacks` lower; to give coins, raise `coins`.
- **First leaderboard query:** the leaderboard sorts `users` by `rp`. Firestore indexes single fields automatically, so no setup is needed. If the browser console ever shows a "requires an index" link, click it once.
- **Late schedules:** GitHub treats cron times as best effort and can run them hours late or skip them, especially on free accounts. That delays forming groups and applying rank points, but never changes the results. **Run workflow** catches up immediately.
- **Paused schedules:** GitHub pauses scheduled workflows after 60 days without repo activity. A commit, or **Run workflow**, turns them back on.
- **Testing without Firebase:** `cd sync && DRY_RUN=1 node nba-sync.mjs` writes JSON to `sync/out/`.
- **Data source:** NBA data comes from ESPN's public, unofficial API. If ESPN changes it, the sync may need updating.
