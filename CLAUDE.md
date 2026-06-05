# TrainLottery Bot - Project Guide

## Project Structure

```
DCBotTrain/
├── package.json              # npm project, scripts: start, deploy-commands
├── .env                      # DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DB_PATH
├── .env.example              # Template
├── .gitignore                # node_modules, data/*.db, .env
├── config/
│   └── default.js            # All default config values (drawTime, poolSizes, pity params)
├── src/
│   ├── index.js              # Entry point: client creation, event/command loader, shutdown handler
│   ├── deploy-commands.js    # One-time script to register slash commands with Discord API
│   ├── database/
│   │   ├── connection.js     # SQLite singleton (WAL mode, pragmas)
│   │   ├── schema.js         # Table creation (players, daily_rankings, draw_history, pending_rankings, guild_config)
│   │   └── queries.js        # All prepared statements: player CRUD, rankings, draws, config
│   ├── lottery/
│   │   ├── parser.js         # parseRanking(text) → {entries, errors} - flexible regex for pasted rankings
│   │   ├── weightCalculator.js  # calculateWeights(entries, config) - pity formula, cooldowns, probabilities
│   │   ├── drawEngine.js     # performDailyDraw(dateStr) - weighted random + hard pity, transactional
│   │   ├── nameMatcher.js    # normalize + Levenshtein similarity, findCandidates/findDuplicatePairs
│   │   ├── mergeEngine.js    # performMerge(fromId, intoId) - fold duplicate player into canonical, transactional
│   │   └── scheduler.js      # node-schedule jobs, countdown, scheduleOneDraw(), staggered backfills
│   ├── commands/             # Slash commands (auto-loaded by index.js)
│   │   ├── config.js         # /train-config - channel, time, pool, pity settings
│   │   ├── plan.js           # /train-plan - upcoming schedule with winners
│   │   ├── history.js        # /train-history - past draw results
│   │   ├── stats.js          # /train-stats - player stats / leaderboard (name autocomplete incl. aliases)
│   │   ├── players.js        # /train-players - list canonical players + possible-duplicate hints
│   │   ├── manual-draw.js    # /train-draw - manual draw trigger with date selection
│   │   ├── redraw.js         # /train-redraw - reuse past ranking (savings week)
│   │   ├── reset-pity.js     # /train-reset-pity - admin pity reset
│   │   ├── skip-day.js       # /train-skip - skip a day's draw
│   │   ├── rename.js         # /train-rename - rename a player
│   │   ├── merge.js          # /train-merge - merge duplicate players (no args = duplicate scanner)
│   │   └── clear.js          # /train-clear - wipe all data (double confirm)
│   ├── events/               # Discord event handlers (auto-loaded by index.js)
│   │   ├── ready.js          # Bot startup, DB init, scheduler init, missed draw recovery
│   │   ├── messageCreate.js  # Admin channel listener: parse ranking → name reconciliation → date selector dropdown
│   │   └── interactionCreate.js  # Routes: slash commands, buttons, select menus (date, redraw)
│   └── ui/
│       ├── embeds.js         # All EmbedBuilder factories (preview, result, admin debug, countdown, announcement, error)
│       └── buttons.js        # Date select dropdown (7 back + 14 forward), confirm/cancel buttons
└── data/
    └── lottery.db            # SQLite database (auto-created, gitignored)
```

## Key Architecture Decisions

- **Message-based ranking input** (not modal) because rankings can be 20-30 lines
- **Game names as identifiers** — no mapping to Discord users
- **All draws are transactional** — wrapped in `db.transaction()` so a failure rolls back completely
- **Pity formula**: `1 + (counter² × 0.05)` with hard pity at 25
- **Date selector re-parses original message** on selection — no in-memory state between steps
- **Deduplication** on messageCreate via Set of processed message IDs
- **Commands prefixed `train-`** to avoid conflicts with other bots
- **Alias resolution is centralized in `upsertPlayer`/`resolvePlayer`** — every name lookup checks the exact player name first, then `player_aliases`, so name variants never create duplicates. On paste, unrecognized names are reconciled interactively (new player vs. alias of existing) before date selection; a full-roster browser handles names that changed completely (no similarity). Existing duplicates are cleaned up with `/train-merge` (duplicate scanner, or `from`/`into` with autocomplete for arbitrary players).

## Database Tables

- `players` — name, train/vip pity counters, last win dates, lifetime stats
- `player_aliases` — alias name → canonical `player_id` (maps OCR/spelling variants & renames to one player)
- `daily_rankings` — date, player_id, rank, points, denormalized weights for audit
- `draw_history` — date, type, winner, probabilities, hard pity flag
- `pending_rankings` — raw text + parsed JSON, status (pending/confirmed/drawn/skipped)
- `guild_config` — key/value store for runtime config

## Common Tasks

### Add a new slash command
1. Create `src/commands/my-command.js` with `data` (SlashCommandBuilder) and `execute(interaction)` exports
2. Run `npm run deploy-commands` to register
3. Restart bot

### Modify the pity formula
Edit `src/lottery/weightCalculator.js` — the formula is on line ~45:
```js
const trainPityMultiplier = 1 + Math.pow(trainPity, pityExponent) * pityCoefficient;
```

### Change embed appearance
All embeds are in `src/ui/embeds.js`. The main result embed is `buildResultEmbed()`.

### Run the bot
```bash
npm run deploy-commands  # only needed when commands change
npm start                # starts the bot
```
