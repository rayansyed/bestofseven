---
name: best-of-7-nba-sync-2
description: Posts NBA slates, injury updates and real box scores to the Best of 7 NBA artifact's database.
---

Sync real NBA data into the "Best of 7 NBA" fantasy game artifact at https://claude.ai/artifact/1Vj8rBBQ26XGxihmfc2kgA.

1. Run this with the Bash tool (it takes ~30 seconds; give it a 5-minute timeout):
   node "C:/Users/rayan/.claude/scheduled-tasks/best-of-7-nba-sync/nba-sync.js"
   It fetches ESPN's public NBA scoreboard, rosters and box scores for yesterday, today and tomorrow (US Eastern dates) and prints one line per date, e.g.
   "20261028: 12 games, 414 players, 0 started, final=false -> C:\...\out\20261028.json".
   Dates with no games print "no NBA games" and are skipped. If it prints "SYNC FAILED", run it once more; if it fails again, stop and report the error.

2. Load the ArtifactData tool (ToolSearch "select:ArtifactData") if needed. Read the current document versions with ArtifactData action "list", url above, collection "days", out_dir "C:/Users/rayan/.claude/scheduled-tasks/best-of-7-nba-sync/pulled" (one call; note each doc's `version`; don't read the bodies).

3. Write them all in ONE ArtifactData "batch" call: for each date the script printed a file for, an entry {op: "set", collection: "days", doc_id: "<YYYYMMDD>", file_path: "<the printed .json path>"} plus if_version: <that doc's version> when the document already existed (omit if_version for a new date). If the batch is refused because a version changed, list again and redo the batch once.

4. Reply with one short line: which dates were written and whether each is final. Never write any other collection (lineups, series, cpulineups belong to the players).