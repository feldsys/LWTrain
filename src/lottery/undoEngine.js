// ─── Undo Engine ───
// Reverses an executed daily draw: restores pity counters, win counts,
// last-win dates, deletes draw_history and daily_rankings rows for the date,
// and removes the pending_rankings row so the date is fully reset.

const { getDb } = require('../database/connection');
const { getConfig, getDrawsForDate, getRankingsForDate, getPendingRanking } = require('../database/queries');
const defaults = require('../../config/default');
const { daysBetween } = require('./weightCalculator');

function cfg(key) {
    try {
        const val = getConfig(key);
        if (val !== undefined) {
            const num = Number(val);
            return Number.isNaN(num) ? val : num;
        }
    } catch { /* fall through */ }
    return defaults[key];
}

/**
 * Reverse the draw for the given date.
 *
 * Wraps the entire reversal in a single SQLite transaction:
 *  - Restores pity, total wins, and last-win dates for the train/VIP winners.
 *  - Decrements pity counters and total_participations for non-winners that
 *    received pity increments at draw time.
 *  - Deletes draw_history and daily_rankings rows for the date.
 *  - Deletes the pending_rankings row so the date is fully reset and a new
 *    ranking can be pasted.
 *
 * @param {string} date - YYYY-MM-DD
 * @returns {Object} { trainWinner, vipWinner, rankingsCount } or throws on error.
 */
function performUndo(date) {
    const draws = getDrawsForDate(date);
    if (draws.length === 0) {
        throw new Error(`No draw found for ${date}.`);
    }

    const rankings = getRankingsForDate(date);
    const pending = getPendingRanking(date);
    const trainPoolSize = cfg('trainPoolSize');
    const vipPoolSize = cfg('vipPoolSize');
    const vipCooldownDays = cfg('vipCooldownDays');

    const trainDraw = draws.find(d => d.draw_type === 'train');
    const vipDraw = draws.find(d => d.draw_type === 'vip');

    const db = getDb();

    const findPreviousWinDate = db.prepare(
        `SELECT date FROM draw_history
         WHERE winner_id = ? AND draw_type = ? AND date < ?
         ORDER BY date DESC LIMIT 1`
    );

    const restoreTrainWinner = db.prepare(
        `UPDATE players SET train_pity_counter = ?,
                            total_train_wins = MAX(0, total_train_wins - 1),
                            last_train_win_date = ?,
                            updated_at = datetime('now')
         WHERE id = ?`
    );

    const restoreVipWinner = db.prepare(
        `UPDATE players SET vip_pity_counter = ?,
                            total_vip_wins = MAX(0, total_vip_wins - 1),
                            last_vip_win_date = ?,
                            updated_at = datetime('now')
         WHERE id = ?`
    );

    const decrementTrainPity = db.prepare(
        `UPDATE players SET train_pity_counter = MAX(0, train_pity_counter - 1),
                            total_participations = MAX(0, total_participations - 1),
                            updated_at = datetime('now')
         WHERE id = ?`
    );

    const decrementVipPity = db.prepare(
        `UPDATE players SET vip_pity_counter = MAX(0, vip_pity_counter - 1),
                            updated_at = datetime('now')
         WHERE id = ?`
    );

    const deleteDrawHistory = db.prepare('DELETE FROM draw_history WHERE date = ?');
    const deleteRankings = db.prepare('DELETE FROM daily_rankings WHERE date = ?');
    const deletePending = db.prepare('DELETE FROM pending_rankings WHERE date = ?');

    const runUndo = db.transaction(() => {
        // Step 1: Restore train winner state
        if (trainDraw) {
            const prev = findPreviousWinDate.get(trainDraw.winner_id, 'train', date);
            restoreTrainWinner.run(
                trainDraw.pity_at_win,
                prev ? prev.date : null,
                trainDraw.winner_id
            );
        }

        // Step 2: Restore VIP winner state
        if (vipDraw) {
            const prev = findPreviousWinDate.get(vipDraw.winner_id, 'vip', date);
            restoreVipWinner.run(
                vipDraw.pity_at_win,
                prev ? prev.date : null,
                vipDraw.winner_id
            );
        }

        // Step 3: Reverse pity increments for non-winners.
        // Train pity: incremented for everyone in trainPoolSize except the train winner.
        // VIP pity: incremented for everyone in vipPoolSize that wasn't on VIP cooldown,
        //   except the VIP winner. Cooldown check uses last_vip_win_date as it stood at
        //   draw time -- for non-VIP-winners that value is unchanged since the draw, so
        //   reading it now is faithful to the original eligibility.
        for (const r of rankings) {
            const isTrainWinner = trainDraw && r.player_id === trainDraw.winner_id;
            const isVipWinner = vipDraw && r.player_id === vipDraw.winner_id;

            if (r.rank <= trainPoolSize && !isTrainWinner) {
                decrementTrainPity.run(r.player_id);
            }

            if (r.rank <= vipPoolSize && !isVipWinner) {
                let onCooldownAtDrawTime = false;
                if (r.last_vip_win_date) {
                    const daysSince = daysBetween(r.last_vip_win_date, date);
                    if (daysSince < vipCooldownDays) onCooldownAtDrawTime = true;
                }
                if (!onCooldownAtDrawTime) {
                    decrementVipPity.run(r.player_id);
                }
            }
        }

        // Step 4: Remove draw artefacts so the date is fully reset.
        deleteDrawHistory.run(date);
        deleteRankings.run(date);
        deletePending.run(date);
    });

    runUndo();

    return {
        trainWinner: trainDraw ? { name: trainDraw.winner_name, rank: trainDraw.winner_rank, points: trainDraw.winner_points } : null,
        vipWinner: vipDraw ? { name: vipDraw.winner_name, rank: vipDraw.winner_rank, points: vipDraw.winner_points } : null,
        rankingsCount: rankings.length,
        pendingDeleted: Boolean(pending),
    };
}

module.exports = { performUndo };
