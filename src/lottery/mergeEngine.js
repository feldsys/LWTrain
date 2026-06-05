// ─── Merge Engine ───
// Merges two player rows that are really the same person (e.g. a name that was
// pasted under two spellings before aliases existed). All history is repointed
// to the surviving ("into") player, lifetime stats are summed, and the merged
// name is kept as an alias so future pastes resolve correctly.
//
// Pity strategy: "active" — the pity counters of the most recently active of the
// two rows survive (that record best reflects the player's current state); the
// most recent last-win dates win; lifetime totals are summed.

const { getDb } = require('../database/connection');
const { getPlayerById } = require('../database/queries');

/** Lexicographically-latest of two YYYY-MM-DD strings (null-safe). */
function laterDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return a >= b ? a : b;
}

/**
 * Merge player `fromId` into player `intoId`.
 *
 * @param {number} fromId  The duplicate to absorb and delete.
 * @param {number} intoId  The surviving canonical player.
 * @returns {object} Summary of what was merged.
 */
function performMerge(fromId, intoId) {
    if (fromId === intoId) throw new Error('Cannot merge a player into itself.');

    const from = getPlayerById(fromId);
    const into = getPlayerById(intoId);
    if (!from) throw new Error(`Source player #${fromId} not found.`);
    if (!into) throw new Error(`Target player #${intoId} not found.`);

    const db = getDb();

    const run = db.transaction(() => {
        // ── daily_rankings ── UNIQUE(date, player_id) means both players can't
        // share a date. Drop the source's row on any date the target also has,
        // then repoint the rest.
        const conflictDates = db.prepare(
            `SELECT date FROM daily_rankings
             WHERE player_id = ? AND date IN (SELECT date FROM daily_rankings WHERE player_id = ?)`
        ).all(fromId, intoId).map(r => r.date);

        const totalFromRankings = db.prepare(
            'SELECT COUNT(*) AS n FROM daily_rankings WHERE player_id = ?'
        ).get(fromId).n;

        if (conflictDates.length > 0) {
            db.prepare(
                `DELETE FROM daily_rankings
                 WHERE player_id = ? AND date IN (SELECT date FROM daily_rankings WHERE player_id = ?)`
            ).run(fromId, intoId);
        }
        db.prepare('UPDATE daily_rankings SET player_id = ? WHERE player_id = ?').run(intoId, fromId);

        // ── draw_history ── repoint winner and refresh denormalized name.
        const movedDraws = db.prepare(
            'UPDATE draw_history SET winner_id = ?, winner_name = ? WHERE winner_id = ?'
        ).run(intoId, into.name, fromId).changes;

        // ── players ── merge stats with the "active record wins" strategy.
        const fromActive = (from.updated_at || '') > (into.updated_at || '');
        const active = fromActive ? from : into;

        db.prepare(
            `UPDATE players SET
                train_pity_counter   = ?,
                vip_pity_counter     = ?,
                last_train_win_date  = ?,
                last_vip_win_date    = ?,
                total_participations = ?,
                total_train_wins     = ?,
                total_vip_wins       = ?,
                updated_at           = datetime('now')
             WHERE id = ?`
        ).run(
            active.train_pity_counter,
            active.vip_pity_counter,
            laterDate(from.last_train_win_date, into.last_train_win_date),
            laterDate(from.last_vip_win_date, into.last_vip_win_date),
            (from.total_participations || 0) + (into.total_participations || 0),
            (from.total_train_wins || 0) + (into.total_train_wins || 0),
            (from.total_vip_wins || 0) + (into.total_vip_wins || 0),
            intoId,
        );

        // ── aliases ── move the source's aliases over, then record its name.
        db.prepare('UPDATE player_aliases SET player_id = ? WHERE player_id = ?').run(intoId, fromId);
        if (from.name.toLowerCase() !== into.name.toLowerCase()) {
            db.prepare(
                'INSERT INTO player_aliases (alias, player_id) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET player_id = ?'
            ).run(from.name, intoId, intoId);
        }

        // ── delete the now-empty source player ──
        db.prepare('DELETE FROM players WHERE id = ?').run(fromId);

        return {
            fromName: from.name,
            intoName: into.name,
            movedRankings: totalFromRankings - conflictDates.length,
            droppedRankingDates: conflictDates,
            movedDraws,
            pitySource: fromActive ? from.name : into.name,
        };
    });

    return run();
}

module.exports = { performMerge };
