const { Events } = require('discord.js');
const { initializeSchema } = require('../database/schema');
const { initScheduler } = require('../lottery/scheduler');
const { getPendingRanking, getDrawsForDate, getConfig } = require('../database/queries');
const { performDailyDraw } = require('../lottery/drawEngine');
const { buildResultEmbed, buildAdminResultEmbed } = require('../ui/embeds');
const defaults = require('../../config/default');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`[READY] Logged in as ${client.user.tag}`);

        // Initialize database
        initializeSchema();
        console.log('[DB] Schema initialized');

        // Initialize scheduler
        initScheduler(client);
        console.log('[SCHEDULER] Daily draw scheduled');

        // Check for missed draws (e.g., bot was offline at draw time)
        await checkMissedDraw(client);
    },
};

async function checkMissedDraw(client) {
    // Check if we're past the draw time
    const drawTime = getConfigValue('drawTime', defaults.drawTime);
    const [drawH, drawM] = drawTime.split(':').map(Number);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const drawMinutes = drawH * 60 + drawM;

    if (nowMinutes <= drawMinutes) return;

    // Find ALL confirmed rankings that haven't been drawn
    const { getDb } = require('../database/connection');
    const db = getDb();
    const missedDraws = db.prepare(`
        SELECT date FROM pending_rankings
        WHERE status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM draw_history dh WHERE dh.date = pending_rankings.date)
        ORDER BY date ASC
    `).all();

    if (missedDraws.length === 0) return;

    console.log(`[READY] ${missedDraws.length} missed draw(s) detected, executing now...`);

    const announcementId = getConfigValue('announcementChannelId', defaults.announcementChannelId);
    const adminId = getConfigValue('adminChannelId', defaults.adminChannelId);

    for (const { date } of missedDraws) {
        try {
            const result = performDailyDraw(date);
            if (!result) continue;

            if (announcementId) {
                const ch = await client.channels.fetch(announcementId);
                if (ch) await ch.send({ embeds: [buildResultEmbed(result)] });
            }
            if (adminId) {
                const ch = await client.channels.fetch(adminId);
                if (ch) await ch.send({ content: `**Missed draw recovered (${date}):**`, embeds: [buildAdminResultEmbed(result)] });
            }

            console.log(`[READY] Missed draw ${date} recovered: Train=${result.trainWinner?.name}, VIP=${result.vipWinner?.name}`);
        } catch (err) {
            console.error(`[READY] Failed to recover missed draw ${date}:`, err);
        }
    }
}

function getConfigValue(key, fallback) {
    try {
        const val = getConfig(key);
        return val !== undefined ? val : fallback;
    } catch {
        return fallback;
    }
}
