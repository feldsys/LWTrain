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
    const today = new Date().toISOString().split('T')[0];
    const pending = getPendingRanking(today);

    if (!pending || pending.status !== 'confirmed') return;

    // Check if draw already happened
    const draws = getDrawsForDate(today);
    if (draws.length > 0) return;

    // Check if we're past the draw time
    const drawTime = getConfigValue('drawTime', defaults.drawTime);
    const [drawH, drawM] = drawTime.split(':').map(Number);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const drawMinutes = drawH * 60 + drawM;

    if (nowMinutes <= drawMinutes) return;

    console.log('[READY] Missed draw detected, executing now...');

    try {
        const result = performDailyDraw();
        if (!result) return;

        const announcementId = getConfigValue('announcementChannelId', defaults.announcementChannelId);
        const adminId = getConfigValue('adminChannelId', defaults.adminChannelId);

        if (announcementId) {
            const ch = await client.channels.fetch(announcementId);
            if (ch) await ch.send({ embeds: [buildResultEmbed(result)] });
        }
        if (adminId) {
            const ch = await client.channels.fetch(adminId);
            if (ch) await ch.send({ content: '**Missed draw recovered on startup:**', embeds: [buildAdminResultEmbed(result)] });
        }

        console.log(`[READY] Missed draw recovered: Train=${result.trainWinner?.name}, VIP=${result.vipWinner?.name}`);
    } catch (err) {
        console.error('[READY] Failed to recover missed draw:', err);
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
