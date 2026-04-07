// ─── Weight Calculator ───
// Fairness algorithm: calculates pity multipliers, effective weights,
// cooldown status, and win probabilities for each player entry.

/**
 * Calculate the number of whole days between two YYYY-MM-DD date strings.
 * Returns a non-negative integer (absolute difference).
 */
function daysBetween(dateStr1, dateStr2) {
    const MS_PER_DAY = 86_400_000;
    const d1 = new Date(dateStr1 + 'T00:00:00Z');
    const d2 = new Date(dateStr2 + 'T00:00:00Z');
    return Math.round(Math.abs(d1 - d2) / MS_PER_DAY);
}

/**
 * Enrich ranking entries with pity multipliers, effective weights,
 * eligibility flags, and win probabilities.
 *
 * @param {Array} entries - Objects from daily_rankings JOIN players:
 *   { player_id, name, rank, points, train_pity_counter, vip_pity_counter,
 *     last_train_win_date, last_vip_win_date }
 * @param {Object} config - { pityCoefficient, pityExponent, hardPityThreshold,
 *   trainCooldownDays, trainPoolSize, vipPoolSize }
 * @returns {Array} Enriched entry objects with weight and eligibility fields.
 */
function calculateWeights(entries, config) {
    const {
        pityCoefficient,
        pityExponent,
        hardPityThreshold,
        trainCooldownDays,
        vipCooldownDays,
        vipPityCoefficient,
        vipPityExponent,
        vipHardPityThreshold,
        trainPoolSize,
        vipPoolSize,
    } = config;

    const today = new Date().toISOString().split('T')[0];

    // First pass: compute per-player fields
    const enriched = entries.map((entry) => {
        const trainPity = entry.train_pity_counter || 0;
        const vipPity = entry.vip_pity_counter || 0;

        // Pity multipliers (train and VIP use separate parameters)
        const trainPityMultiplier = 1 + Math.pow(trainPity, pityExponent) * pityCoefficient;
        const vipPityMultiplier = 1 + Math.pow(vipPity, vipPityExponent) * vipPityCoefficient;

        // Effective weights
        const points = entry.points || 0;
        const trainEffectiveWeight = points * trainPityMultiplier;
        const vipEffectiveWeight = points * vipPityMultiplier;

        // Train cooldown check
        let onTrainCooldown = false;
        let daysUntilTrainEligible = 0;
        if (entry.last_train_win_date) {
            const daysSinceWin = daysBetween(entry.last_train_win_date, today);
            if (daysSinceWin < trainCooldownDays) {
                onTrainCooldown = true;
                daysUntilTrainEligible = trainCooldownDays - daysSinceWin;
            }
        }

        // VIP cooldown check
        let onVipCooldown = false;
        let daysUntilVipEligible = 0;
        if (entry.last_vip_win_date) {
            const daysSinceWin = daysBetween(entry.last_vip_win_date, today);
            if (daysSinceWin < vipCooldownDays) {
                onVipCooldown = true;
                daysUntilVipEligible = vipCooldownDays - daysSinceWin;
            }
        }

        // Hard pity flags (separate thresholds)
        const isTrainHardPity = trainPity >= hardPityThreshold;
        const isVipHardPity = vipPity >= vipHardPityThreshold;

        // Eligibility
        const eligibleForTrain = !onTrainCooldown && entry.rank <= trainPoolSize;
        const eligibleForVip = !onVipCooldown && entry.rank <= vipPoolSize;

        return {
            ...entry,
            trainPityMultiplier,
            vipPityMultiplier,
            trainEffectiveWeight,
            vipEffectiveWeight,
            onTrainCooldown,
            onVipCooldown,
            isTrainHardPity,
            isVipHardPity,
            eligibleForTrain,
            eligibleForVip,
            daysUntilTrainEligible,
            daysUntilVipEligible,
            // Placeholders - computed in second pass
            trainWinProbability: 0,
            vipWinProbability: 0,
        };
    });

    // Second pass: calculate probabilities among eligible players
    const trainEligible = enriched.filter((e) => e.eligibleForTrain);
    const totalTrainWeight = trainEligible.reduce((sum, e) => sum + e.trainEffectiveWeight, 0);

    const vipEligible = enriched.filter((e) => e.eligibleForVip);
    const totalVipWeight = vipEligible.reduce((sum, e) => sum + e.vipEffectiveWeight, 0);

    for (const entry of enriched) {
        if (entry.eligibleForTrain && totalTrainWeight > 0) {
            entry.trainWinProbability = entry.trainEffectiveWeight / totalTrainWeight;
        }
        if (entry.eligibleForVip && totalVipWeight > 0) {
            entry.vipWinProbability = entry.vipEffectiveWeight / totalVipWeight;
        }
    }

    return enriched;
}

module.exports = { calculateWeights, daysBetween };
