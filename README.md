# TrainLottery Bot

Discord bot for fair allocation of the daily alliance train and VIP seat in Last War. Uses a weighted lottery system with a pity mechanic that ensures consistent participants eventually win.

## Setup

1. Create a Discord bot at https://discord.com/developers/applications
2. Enable **Message Content Intent** under Bot → Privileged Gateway Intents
3. Copy `.env.example` to `.env` and fill in your values:
   ```
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_application_id
   DISCORD_GUILD_ID=your_server_id
   ```
4. Install dependencies: `npm install`
5. Register slash commands: `npm run deploy-commands`
6. Start the bot: `npm start`
7. In Discord: configure channels with `/train-config`

### Invite URL

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=84992&scope=bot%20applications.commands
```

Permissions: View Channels, Send Messages, Embed Links, Read Message History.

## Commands

### Admin Commands (require Manage Server permission)

| Command | Description |
|---|---|
| `/train-config show` | Show current bot configuration |
| `/train-config set-admin-channel #channel` | Set the channel where rankings are pasted |
| `/train-config set-announcement-channel #channel` | Set the channel for draw results |
| `/train-config set-draw-time HH:MM [timezone]` | Set daily draw time (default: 20:00 Europe/Berlin) |
| `/train-config set-pool-size train vip` | Set how many top players are eligible (default: 20/20) |
| `/train-config set-pity [coefficient] [exponent] [hard-pity]` | Tune the pity system |
| `/train-draw` | Manually trigger a draw (shows all pending confirmed rankings) |
| `/train-redraw` | Reuse a past ranking for a new day (savings week) |
| `/train-skip [reason]` | Skip today's draw |
| `/train-reset-pity player [type]` | Reset a player's pity counter |
| `/train-rename old-name new-name` | Rename a player (keeps all stats) |
| `/train-clear` | Delete ALL data (double confirmation required) |

### Public Commands

| Command | Description |
|---|---|
| `/train-plan [days]` | Show upcoming train & VIP schedule (default: 14 days) |
| `/train-history [days] [type]` | View past draw results |
| `/train-stats [player]` | View player stats or leaderboard |

## Daily Workflow

1. **Paste ranking** in the admin channel (format: `Name Points`, one per line)
2. Bot parses and shows a **date selector** (7 days back + 14 days ahead)
3. Select the date → **preview** with pity counters, weights, probabilities
4. **Confirm** → draw is scheduled, announcement posted in public channel
5. At draw time (or via `/train-draw`) → **winners announced** with rich embed

Rankings can also be posted without rank numbers:
```
PlayerAlpha 12345
PlayerBeta 11000
PlayerGamma 9500
```

Or with rank numbers:
```
1. PlayerAlpha 12345
2. PlayerBeta 11000
3. PlayerGamma 9500
```

## Fairness System

### Pity Mechanic
- **Base weight** = daily points (each point is a lottery ticket)
- **Pity multiplier** = `1 + (participations_without_win² × 0.05)`
- After 20 participations without winning: ~21x multiplier (~50% chance per draw)
- **Hard pity at 25**: guaranteed win

### Multiplier Table
| Pity Counter | Multiplier |
|---|---|
| 0 | 1.0x |
| 5 | 2.25x |
| 10 | 6.0x |
| 15 | 12.25x |
| 20 | 21.0x |
| 25 | **Guaranteed** |

### Rules
- **Train cooldown**: Winner can't win train again for 14 days
- **VIP**: No cooldown, separate pity counter
- **Separate pools**: Train winner is excluded from VIP draw
- **Cooldown players still accumulate pity** for when they become eligible again
- Players not in the ranking on a given day: pity unchanged

## Backfill & Redraw

- **Backfill**: Paste a ranking and select a past date from the dropdown
- **Advance planning**: Select a future date (up to 14 days ahead)
- **Redraw** (`/train-redraw`): Reuse a past ranking for a new day — perfect for savings weeks where the same ranking applies for a second week

## Tech Stack

- **Runtime**: Node.js
- **Discord**: discord.js v14
- **Database**: SQLite (better-sqlite3)
- **Scheduling**: node-schedule
- **Config**: dotenv
