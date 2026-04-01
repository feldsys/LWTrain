// ─── Draw Engine ───
// Executes the daily lottery draw: loads rankings, calculates weights,
// selects train and VIP winners via hard-pity or weighted random,
// updates pity counters, and records results -- all in a single transaction.

const { getDb } = require('../database/connection');
const {
    upsertPlayer,
    insertDailyRanking,
    getRankingsForDate,
    getConfig,
    recordTrainWin,
    recordVipWin,
    incrementTrainPity,
    incrementVipPity,
    insertDrawResult,
    updateRankingWeights,
    getPendingRanking,
    markPendingAsDrawn,
} = require('../database/queries');
const defaults = require('../../config/default');
const { calculateWeights } = require('./weightCalculator');

/**
 * Weighted random selection from an array of entries.
 * Picks one entry proportional to entry[weightKey].
 *
 * @param {Array} entries - Non-empty array of objects.
 * @param {string} weightKey - Property name holding the numeric weight.
 * @returns {Object} The selected entry.
 */
function weightedRandomSelect(entries, weightKey) {
    const totalWeight = entries.reduce((sum, e) => sum + (e[weightKey] || 0), 0);
    if (totalWeight <= 0) return entries[0];

    let random = Math.random() * totalWeight;
    for (const entry of entries) {
        random -= (entry[weightKey] || 0);
        if (random <= 0) return entry;
    }
    // Floating-point guard: return last entry if we fall through
    return entries[entries.length - 1];
}

/**
 * Read a config value from the database, falling back to config/default.js.
 */
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
 * Select a winner from eligible entries.
 * Hard-pity players win automatically (highest pity, tiebreak: highest points).
 * Otherwise a weighted random draw is performed.
 *
 * @param {Array} eligible - Enriched entries that are eligible.
 * @param {string} pityFlag - Property name for hard-pity boolean (e.g. 'isTrainHardPity').
 * @param {string} weightKey - Property name for effective weight (e.g. 'trainEffectiveWeight').
 * @param {string} pityCounterKey - Property name for the raw pity counter (e.g. 'train_pity_counter').
 * @returns {{ winner: Object, wasHardPity: boolean }}
 */
function selectWinner(eligible, pityFlag, weightKey, pityCounterKey) {
    // Check for hard pity
    const hardPityPlayers = eligible.filter((e) => e[pityFlag]);

    if (hardPityPlayers.length > 0) {
        // Highest pity counter wins; tiebreak by highest points
        hardPityPlayers.sort((a, b) => {
            const pityDiff = (b[pityCounterKey] || 0) - (a[pityCounterKey] || 0);
            if (pityDiff !== 0) return pityDiff;
            return (b.points || 0) - (a.points || 0);
        });
        return { winner: hardPityPlayers[0], wasHardPity: true };
    }

    // Weighted random
    const winner = weightedRandomSelect(eligible, weightKey);
    return { winner, wasHardPity: false };
}

/**
 * Execute the daily draw.
 *
 * Loads confirmed rankings, calculates weights, selects train and VIP winners,
 * updates pity counters, records draw history, and marks the pending ranking
 * as drawn -- all wrapped in a single SQLite transaction.
 *
 * @param {string} [dateOverride] - Optional YYYY-MM-DD date. Defaults to today.
 * @returns {Object|null} Result object with winners and stats, or null if no
 *   confirmed ranking exists.
 */
function performDailyDraw(dateOverride) {
    const date = dateOverride || new Date().toISOString().split('T')[0];

    // Pre-check: pending ranking must exist and be confirmed
    const pending = getPendingRanking(date);
    if (!pending || pending.status !== 'confirmed') {
        return null;
    }

    const parsedEntries = JSON.parse(pending.parsed_json);

    // Load config values
    const config = {
        pityCoefficient: cfg('pityCoefficient'),
        pityExponent: cfg('pityExponent'),
        hardPityThreshold: cfg('hardPityThreshold'),
        trainCooldownDays: cfg('trainCooldownDays'),
        trainPoolSize: cfg('trainPoolSize'),
        vipPoolSize: cfg('vipPoolSize'),
    };

    // Wrap all DB mutations in a single transaction
    const db = getDb();
    const runDraw = db.transaction(() => {
        // Step 4: Upsert players and insert daily rankings
        // Clear existing rankings first (they may have been inserted at confirm time)
        const { deleteRankingsForDate } = require('../database/queries');
        deleteRankingsForDate(date);
        for (const entry of parsedEntries) {
            const player = upsertPlayer(entry.name);
            insertDailyRanking(date, player.id, entry.rank, entry.points);
        }

        // Step 5: Fetch full rankings joined with player data
        const fullRankings = getRankingsForDate(date);

        // Step 7: Calculate weights
        const enriched = calculateWeights(fullRankings, config);

        // ─── Train Draw ───
        const trainEligible = enriched.filter((e) => e.eligibleForTrain);
        let trainWinner = null;
        let trainWasHardPity = false;
        let trainTotalWeight = 0;

        if (trainEligible.length > 0) {
            trainTotalWeight = trainEligible.reduce((s, e) => s + e.trainEffectiveWeight, 0);
            const trainResult = selectWinner(
                trainEligible, 'isTrainHardPity', 'trainEffectiveWeight', 'train_pity_counter'
            );
            trainWinner = trainResult.winner;
            trainWasHardPity = trainResult.wasHardPity;

            // Record train win
            recordTrainWin(trainWinner.player_id, date);
            insertDrawResult({
                date,
                drawType: 'train',
                winnerId: trainWinner.player_id,
                winnerName: trainWinner.name,
                winnerRank: trainWinner.rank,
                winnerPoints: trainWinner.points,
                pityAtWin: trainWinner.train_pity_counter || 0,
                effectiveWeight: trainWinner.trainEffectiveWeight,
                totalPoolWeight: trainTotalWeight,
                winProbability: trainTotalWeight > 0
                    ? trainWinner.trainEffectiveWeight / trainTotalWeight
                    : 0,
                wasHardPity: trainWasHardPity,
                eligibleCount: trainEligible.length,
            });
        }

        // ─── VIP Draw ───
        const vipEligible = enriched.filter((e) =>
            e.eligibleForVip && (!trainWinner || e.player_id !== trainWinner.player_id)
        );
        let vipWinner = null;
        let vipWasHardPity = false;
        let vipTotalWeight = 0;

        if (vipEligible.length > 0) {
            vipTotalWeight = vipEligible.reduce((s, e) => s + e.vipEffectiveWeight, 0);
            const vipResult = selectWinner(
                vipEligible, 'isVipHardPity', 'vipEffectiveWeight', 'vip_pity_counter'
            );
            vipWinner = vipResult.winner;
            vipWasHardPity = vipResult.wasHardPity;

            // Record VIP win
            recordVipWin(vipWinner.player_id, date);
            insertDrawResult({
                date,
                drawType: 'vip',
                winnerId: vipWinner.player_id,
                winnerName: vipWinner.name,
                winnerRank: vipWinner.rank,
                winnerPoints: vipWinner.points,
                pityAtWin: vipWinner.vip_pity_counter || 0,
                effectiveWeight: vipWinner.vipEffectiveWeight,
                totalPoolWeight: vipTotalWeight,
                winProbability: vipTotalWeight > 0
                    ? vipWinner.vipEffectiveWeight / vipTotalWeight
                    : 0,
                wasHardPity: vipWasHardPity,
                eligibleCount: vipEligible.length,
            });
        }

        // ─── Update Pity Counters for Non-Winners ───
        // Train pity: increment for all in trainPoolSize who didn't win train
        // (includes players on cooldown -- they still accumulate pity)
        for (const entry of enriched) {
            if (entry.rank <= config.trainPoolSize) {
                if (!trainWinner || entry.player_id !== trainWinner.player_id) {
                    incrementTrainPity(entry.player_id);
                }
            }
        }

        // VIP pity: increment for all VIP-eligible who didn't win VIP
        for (const entry of enriched) {
            if (entry.eligibleForVip) {
                if (!vipWinner || entry.player_id !== vipWinner.player_id) {
                    incrementVipPity(entry.player_id);
                }
            }
        }

        // ─── Audit Trail: Write Weights to Rankings Table ───
        for (const entry of enriched) {
            // Store train weights for train-eligible, vip weights for vip-eligible
            const pityMult = entry.eligibleForTrain
                ? entry.trainPityMultiplier
                : entry.vipPityMultiplier;
            const effWeight = entry.eligibleForTrain
                ? entry.trainEffectiveWeight
                : entry.vipEffectiveWeight;
            const winProb = entry.eligibleForTrain
                ? entry.trainWinProbability
                : entry.vipWinProbability;

            updateRankingWeights(date, entry.player_id, pityMult, effWeight, winProb);
        }

        // ─── Mark Pending as Drawn ───
        markPendingAsDrawn(date);

        // ─── Build Result ───
        return {
            date,
            trainWinner: trainWinner ? {
                name: trainWinner.name,
                rank: trainWinner.rank,
                points: trainWinner.points,
                pity: trainWinner.train_pity_counter || 0,
                probability: trainTotalWeight > 0
                    ? trainWinner.trainEffectiveWeight / trainTotalWeight
                    : 0,
                wasHardPity: trainWasHardPity,
            } : null,
            vipWinner: vipWinner ? {
                name: vipWinner.name,
                rank: vipWinner.rank,
                points: vipWinner.points,
                pity: vipWinner.vip_pity_counter || 0,
                probability: vipTotalWeight > 0
                    ? vipWinner.vipEffectiveWeight / vipTotalWeight
                    : 0,
                wasHardPity: vipWasHardPity,
            } : null,
            rankings: enriched,
            trainEligibleCount: trainEligible.length,
            vipEligibleCount: vipEligible.length,
        };
    });

    // Execute the transaction
    return runDraw();
}

module.exports = { performDailyDraw, weightedRandomSelect };
