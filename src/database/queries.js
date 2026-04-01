const { getDb } = require('./connection');

// ─── Config ───

function getConfig(key) {
    const row = getDb().prepare('SELECT value FROM guild_config WHERE key = ?').get(key);
    return row ? row.value : undefined;
}

function setConfig(key, value) {
    getDb().prepare(
        'INSERT INTO guild_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
    ).run(key, String(value), String(value));
}

function getAllConfig() {
    return getDb().prepare('SELECT key, value FROM guild_config').all();
}

// ─── Players ───

function upsertPlayer(name) {
    getDb().prepare(
        'INSERT INTO players (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET updated_at = datetime(\'now\')'
    ).run(name);
    return getDb().prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
}

function getPlayer(name) {
    return getDb().prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
}

function getPlayerById(id) {
    return getDb().prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function updatePlayerPity(playerId, { trainPity, vipPity }) {
    const sets = [];
    const params = [];
    if (trainPity !== undefined) { sets.push('train_pity_counter = ?'); params.push(trainPity); }
    if (vipPity !== undefined) { sets.push('vip_pity_counter = ?'); params.push(vipPity); }
    sets.push('updated_at = datetime(\'now\')');
    params.push(playerId);
    getDb().prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function recordTrainWin(playerId, date) {
    getDb().prepare(
        'UPDATE players SET train_pity_counter = 0, last_train_win_date = ?, total_train_wins = total_train_wins + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(date, playerId);
}

function recordVipWin(playerId, date) {
    getDb().prepare(
        'UPDATE players SET vip_pity_counter = 0, last_vip_win_date = ?, total_vip_wins = total_vip_wins + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(date, playerId);
}

function incrementTrainPity(playerId) {
    getDb().prepare(
        'UPDATE players SET train_pity_counter = train_pity_counter + 1, total_participations = total_participations + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(playerId);
}

function incrementVipPity(playerId) {
    getDb().prepare(
        'UPDATE players SET vip_pity_counter = vip_pity_counter + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(playerId);
}

function resetPlayerPity(playerId, type) {
    if (type === 'train' || type === 'both') {
        getDb().prepare('UPDATE players SET train_pity_counter = 0, updated_at = datetime(\'now\') WHERE id = ?').run(playerId);
    }
    if (type === 'vip' || type === 'both') {
        getDb().prepare('UPDATE players SET vip_pity_counter = 0, updated_at = datetime(\'now\') WHERE id = ?').run(playerId);
    }
}

function getAllPlayers() {
    return getDb().prepare('SELECT * FROM players ORDER BY name').all();
}

// ─── Rankings ───

function insertDailyRanking(date, playerId, rank, points) {
    getDb().prepare(
        'INSERT INTO daily_rankings (date, player_id, rank, points) VALUES (?, ?, ?, ?)'
    ).run(date, playerId, rank, points);
}

function updateRankingWeights(date, playerId, pityMultiplier, effectiveWeight, winProbability) {
    getDb().prepare(
        'UPDATE daily_rankings SET pity_multiplier = ?, effective_weight = ?, win_probability = ? WHERE date = ? AND player_id = ?'
    ).run(pityMultiplier, effectiveWeight, winProbability, date, playerId);
}

function getRankingsForDate(date) {
    return getDb().prepare(`
        SELECT dr.*, p.name, p.train_pity_counter, p.vip_pity_counter,
               p.last_train_win_date, p.last_vip_win_date,
               p.total_train_wins, p.total_vip_wins, p.total_participations
        FROM daily_rankings dr
        JOIN players p ON dr.player_id = p.id
        WHERE dr.date = ?
        ORDER BY dr.rank ASC
    `).all(date);
}

function deleteRankingsForDate(date) {
    getDb().prepare('DELETE FROM daily_rankings WHERE date = ?').run(date);
}

// ─── Pending Rankings ───

function savePendingRanking(date, rawText, parsedJson, rankingDate) {
    if (rankingDate) {
        getDb().prepare(
            'INSERT INTO pending_rankings (date, ranking_date, raw_text, parsed_json) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET ranking_date = ?, raw_text = ?, parsed_json = ?, status = \'pending\', updated_at = datetime(\'now\')'
        ).run(date, rankingDate, rawText, parsedJson, rankingDate, rawText, parsedJson);
    } else {
        getDb().prepare(
            'INSERT INTO pending_rankings (date, raw_text, parsed_json) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET raw_text = ?, parsed_json = ?, status = \'pending\', updated_at = datetime(\'now\')'
        ).run(date, rawText, parsedJson, rawText, parsedJson);
    }
}

function getUsedDates() {
    const db = getDb();
    const dates = new Set();
    // Dates used as train/draw dates
    const drawDates = db.prepare('SELECT DISTINCT date FROM draw_history').all();
    for (const r of drawDates) dates.add(r.date);
    // Dates used as ranking source dates
    const rankingDates = db.prepare('SELECT DISTINCT ranking_date FROM pending_rankings WHERE ranking_date IS NOT NULL AND status != \'skipped\'').all();
    for (const r of rankingDates) if (r.ranking_date) dates.add(r.ranking_date);
    // Dates with confirmed/drawn pending rankings (train dates)
    const pendingDates = db.prepare('SELECT DISTINCT date FROM pending_rankings WHERE status IN (\'confirmed\', \'drawn\')').all();
    for (const r of pendingDates) dates.add(r.date);
    return dates;
}

function confirmPendingRanking(date, userId) {
    getDb().prepare(
        'UPDATE pending_rankings SET status = \'confirmed\', confirmed_by = ?, updated_at = datetime(\'now\') WHERE date = ?'
    ).run(userId, date);
}

function getPendingRanking(date) {
    return getDb().prepare('SELECT * FROM pending_rankings WHERE date = ?').get(date);
}

function markPendingAsDrawn(date) {
    getDb().prepare(
        'UPDATE pending_rankings SET status = \'drawn\', updated_at = datetime(\'now\') WHERE date = ?'
    ).run(date);
}

function skipPendingRanking(date) {
    getDb().prepare(
        'UPDATE pending_rankings SET status = \'skipped\', updated_at = datetime(\'now\') WHERE date = ?'
    ).run(date);
}

// ─── Draw History ───

function insertDrawResult(data) {
    getDb().prepare(`
        INSERT INTO draw_history (date, draw_type, winner_id, winner_name, winner_rank, winner_points,
            pity_at_win, effective_weight, total_pool_weight, win_probability, was_hard_pity, eligible_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        data.date, data.drawType, data.winnerId, data.winnerName, data.winnerRank, data.winnerPoints,
        data.pityAtWin, data.effectiveWeight, data.totalPoolWeight, data.winProbability,
        data.wasHardPity ? 1 : 0, data.eligibleCount
    );
}

function getDrawHistory(days = 7, type = null) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    const dateStr = dateLimit.toISOString().split('T')[0];

    if (type && type !== 'all') {
        return getDb().prepare(
            'SELECT * FROM draw_history WHERE date >= ? AND draw_type = ? ORDER BY date DESC, draw_type'
        ).all(dateStr, type);
    }
    return getDb().prepare(
        'SELECT * FROM draw_history WHERE date >= ? ORDER BY date DESC, draw_type'
    ).all(dateStr);
}

function getDrawsForDate(date) {
    return getDb().prepare('SELECT * FROM draw_history WHERE date = ?').all(date);
}

function getPlayerDrawHistory(playerId) {
    return getDb().prepare(
        'SELECT * FROM draw_history WHERE winner_id = ? ORDER BY date DESC'
    ).all(playerId);
}

module.exports = {
    // Config
    getConfig, setConfig, getAllConfig,
    // Players
    upsertPlayer, getPlayer, getPlayerById, updatePlayerPity,
    recordTrainWin, recordVipWin, incrementTrainPity, incrementVipPity,
    resetPlayerPity, getAllPlayers,
    // Rankings
    insertDailyRanking, updateRankingWeights, getRankingsForDate, deleteRankingsForDate,
    // Pending
    savePendingRanking, confirmPendingRanking, getPendingRanking, markPendingAsDrawn, skipPendingRanking, getUsedDates,
    // History
    insertDrawResult, getDrawHistory, getDrawsForDate, getPlayerDrawHistory,
};
