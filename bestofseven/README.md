# Best of 7 · NBA

Head-to-head NBA fantasy. Each night you draft six real players (2 G, 2 F, 1 C, 1 UTIL) under a salary cap, name a captain whose points count 1.5×, and score from that night's real box scores. Play a friend or the computer; first to four game wins takes the week.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The game. A static page, hosted on Vercel. |
| `config.js` | Your Firebase web config (public values). |
| `firestore.rules` | Who can read and write what, including the lineup lock at tip-off. |
| `sync/nba-sync.mjs` | Pulls ESPN's public NBA scoreboard, rosters, injuries and box scores into Firestore. |
| `.github/workflows/nba-sync.yml` | Runs the sync on a schedule from GitHub Actions. |

Firebase handles sign-in (an emailed link, no passwords) and stores everything:

- `days/<YYYYMMDD>`: a night's games, player pool, salaries, injury tags and box scores (written by the sync)
- `meta/averages`: running season fantasy averages (written by the sync)
- `series/<id>`: a series: owner, seats, team names, cap, Game 1 date
- `series/<id>/lineups/<date>_<uid>`: a manager's lineup and captain for one night

## Setup (about 15 minutes)

### 1. Create a Firebase project
Go to https://console.firebase.google.com, click **Add project**, and follow the prompts. Google Analytics isn't needed. The free Spark plan is enough.

### 2. Turn on email sign-in
**Build → Authentication → Get started → Sign-in method → Email/Password**. Enable it, then also enable **Email link (passwordless sign-in)**, and save.

Then **Authentication → Settings → Authorized domains → Add domain**, and add your Vercel domain (for example `bestofseven.vercel.app`). Sign-in links only work on authorized domains.

### 3. Create the database and its rules
**Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.

### 4. Add your web config
**Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app (no hosting needed), copy the `firebaseConfig` values into `config.js`, and commit it.

### 5. Give the sync access
**Project settings → Service accounts → Generate new private key**. This downloads a JSON file. **Don't commit it.** In GitHub, open the repo's **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: paste the entire contents of the JSON file

Then delete the downloaded file.

### 6. Run the first sync
In GitHub, open **Actions → NBA sync → Run workflow**. The first run folds in the season so far and posts yesterday's, today's and tomorrow's slates. After that it runs by itself:
- every 30 minutes from 6 PM to 3:30 AM ET, for live scores
- at 9 AM, 1 PM and 4 PM ET, for final results and injury updates

### 7. Deploy on Vercel
Import the repo in Vercel with **Framework preset: Other**, no build command and no output directory, then deploy. Open the site, sign in with your email, and start a series.

## Playing a friend
Start a series and choose **A friend**. Copy the invite link from the card that appears and send it. Your friend signs in with their email and presses **Join**. Lineups stay hidden from each other in the game until tip-off. The rules refuse lineup changes after the first game of the night starts.

## Rules of the game
- **Scoring:** point 1 · rebound 1.2 · assist 1.5 · steal 3 · block 3 · turnover −1. The captain scores 1.5×.
- **Salaries:** fantasy points per game this season × 222 credits, from 3,000 to 12,000 credits. They freeze at the first tip-off.
- **The series:** Game 1 is the night you choose. Each NBA game day after that is the next game, until someone wins four.
- **Ties and skipped nights:** a tie goes to the side with the best single player. A night where neither side set a lineup doesn't count.

## Notes
- GitHub pauses scheduled workflows in a repo with no activity for 60 days. Any commit, or **Run workflow**, turns it back on.
- Test the sync locally without Firebase: `cd sync && DRY_RUN=1 node nba-sync.mjs`. It writes JSON to `sync/out/`.
- NBA data comes from ESPN's public, unofficial API. If ESPN changes it, the sync may need updating.
