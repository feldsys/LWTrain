const { getDb } = require('./connection');

function initializeSchema() {
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL UNIQUE COLLATE NOCASE,
            train_pity_counter  INTEGER NOT NULL DEFAULT 0,
            vip_pity_counter    INTEGER NOT NULL DEFAULT 0,
            last_train_win_date TEXT DEFAULT NULL,
            last_vip_win_date   TEXT DEFAULT NULL,
            total_participations    INTEGER NOT NULL DEFAULT 0,
            total_train_wins        INTEGER NOT NULL DEFAULT 0,
            total_vip_wins          INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS daily_rankings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT NOT NULL,
            player_id       INTEGER NOT NULL,
            rank            INTEGER NOT NULL,
            points          INTEGER NOT NULL,
            pity_multiplier     REAL DEFAULT NULL,
            effective_weight    REAL DEFAULT NULL,
            win_probability     REAL DEFAULT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id),
            UNIQUE(date, player_id),
            UNIQUE(date, rank)
        );

        CREATE TABLE IF NOT EXISTS draw_history (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            date                TEXT NOT NULL,
            draw_type           TEXT NOT NULL CHECK(draw_type IN ('train', 'vip')),
            winner_id           INTEGER NOT NULL,
            winner_name         TEXT NOT NULL,
            winner_rank         INTEGER NOT NULL,
            winner_points       INTEGER NOT NULL,
            pity_at_win         INTEGER NOT NULL,
            effective_weight    REAL NOT NULL,
            total_pool_weight   REAL NOT NULL,
            win_probability     REAL NOT NULL,
            was_hard_pity       INTEGER NOT NULL DEFAULT 0,
            eligible_count      INTEGER NOT NULL,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (winner_id) REFERENCES players(id)
        );

        CREATE TABLE IF NOT EXISTS guild_config (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_aliases (
            alias       TEXT NOT NULL UNIQUE COLLATE NOCASE,
            player_id   INTEGER NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pending_rankings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT NOT NULL UNIQUE,
            ranking_date    TEXT DEFAULT NULL,
            raw_text        TEXT NOT NULL,
            parsed_json     TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'confirmed', 'drawn', 'skipped')),
            confirmed_by    TEXT DEFAULT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_daily_rankings_date ON daily_rankings(date);
        CREATE INDEX IF NOT EXISTS idx_daily_rankings_player ON daily_rankings(player_id);
        CREATE INDEX IF NOT EXISTS idx_draw_history_date ON draw_history(date);
        CREATE INDEX IF NOT EXISTS idx_draw_history_winner ON draw_history(winner_id);
        CREATE INDEX IF NOT EXISTS idx_draw_history_type ON draw_history(draw_type);
        CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
        CREATE INDEX IF NOT EXISTS idx_player_aliases_player ON player_aliases(player_id);
    `);

    // Migration: add ranking_date column if missing (for existing databases)
    try {
        db.exec('ALTER TABLE pending_rankings ADD COLUMN ranking_date TEXT DEFAULT NULL');
    } catch { /* column already exists */ }
}

module.exports = { initializeSchema };
