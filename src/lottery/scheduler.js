const schedule = require('node-schedule');
const { getConfig } = require('../database/queries');
const defaults = require('../../config/default');

let drawJob = null;
let countdownJob = null;
let clientRef = null;

// Track scheduled one-off draws: Map<dateStr, { job, drawTime }>
const scheduledDraws = new Map();
// Stagger interval in minutes between multiple draws
const STAGGER_MINUTES = 5;

function initScheduler(client) {
    clientRef = client;
    reschedule();
}

function reschedule() {
    if (drawJob) { drawJob.cancel(); drawJob = null; }
    if (countdownJob) { countdownJob.cancel(); countdownJob = null; }

    const drawTime = getConfigValue('drawTime', defaults.drawTime);
    const timezone = getConfigValue('timezone', defaults.timezone);
    const countdownMinutes = parseInt(getConfigValue('countdownMinutes', defaults.countdownMinutes), 10);

    const [hour, minute] = drawTime.split(':').map(Number);

    // Schedule daily recurring draw - executes ALL confirmed pending rankings
    const drawRule = new schedule.RecurrenceRule();
    drawRule.hour = hour;
    drawRule.minute = minute;
    drawRule.tz = timezone;
    drawJob = schedule.scheduleJob(drawRule, () => executeAllPendingDraws());

    // Schedule countdown
    let countdownMin = minute - countdownMinutes;
    let countdownHour = hour;
    if (countdownMin < 0) {
        countdownMin += 60;
        countdownHour = (countdownHour - 1 + 24) % 24;
    }
    const countdownRule = new schedule.RecurrenceRule();
    countdownRule.hour = countdownHour;
    countdownRule.minute = countdownMin;
    countdownRule.tz = timezone;
    countdownJob = schedule.scheduleJob(countdownRule, () => sendCountdown());

    console.log(`[SCHEDULER] Draw at ${drawTime} ${timezone}, countdown ${countdownMinutes}min before`);
}

/**
 * Schedule a one-off draw for a specific date.
 * If it's today's date, it will run at the normal draw time.
 * If it's a past date (backfill), it schedules for the next available slot today.
 *
 * @param {Client} client - Discord client
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Date} The scheduled draw time
 */
function scheduleOneDraw(client, dateStr) {
    clientRef = client;

    const today = new Date().toISOString().split('T')[0];
    const drawTime = getConfigValue('drawTime', defaults.drawTime);
    const [baseHour, baseMinute] = drawTime.split(':').map(Number);

    let drawDate;

    if (dateStr === today) {
        // Today's ranking: use the normal draw time (handled by recurring job)
        drawDate = new Date();
        drawDate.setHours(baseHour, baseMinute, 0, 0);

        // If draw time already passed, schedule 2 minutes from now
        if (drawDate <= new Date()) {
            drawDate = new Date(Date.now() + 2 * 60 * 1000);
        }
    } else {
        // Backfill: schedule staggered from base draw time
        drawDate = new Date();
        drawDate.setHours(baseHour, baseMinute, 0, 0);

        // If base time is in the past, start from now + 2 minutes
        if (drawDate <= new Date()) {
            drawDate = new Date(Date.now() + 2 * 60 * 1000);
        }

        // Stagger: add STAGGER_MINUTES for each already-scheduled draw
        const existingCount = scheduledDraws.size;
        drawDate = new Date(drawDate.getTime() + existingCount * STAGGER_MINUTES * 60 * 1000);
    }

    // Cancel existing job for this date if any
    if (scheduledDraws.has(dateStr)) {
        scheduledDraws.get(dateStr).job.cancel();
        scheduledDraws.delete(dateStr);
    }

    // Schedule the one-off job
    const job = schedule.scheduleJob(drawDate, () => {
        scheduledDraws.delete(dateStr);
        executeDrawForDate(dateStr);
    });

    scheduledDraws.set(dateStr, { job, drawTime: drawDate });
    console.log(`[SCHEDULER] One-off draw for ${dateStr} scheduled at ${drawDate.toLocaleTimeString()}`);

    return drawDate;
}

/**
 * Execute ALL confirmed pending rankings that haven't been drawn yet.
 * Called by the daily recurring job at draw time.
 */
async function executeAllPendingDraws() {
    const { getDb } = require('../database/connection');
    const db = getDb();

    const pendingDraws = db.prepare(`
        SELECT date FROM pending_rankings
        WHERE status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM draw_history dh WHERE dh.date = pending_rankings.date)
        ORDER BY date ASC
    `).all();

    if (pendingDraws.length === 0) {
        console.log('[SCHEDULER] No pending draws at scheduled time');
        return;
    }

    console.log(`[SCHEDULER] Executing ${pendingDraws.length} pending draw(s)`);

    for (const { date } of pendingDraws) {
        await executeDrawForDate(date);
        // Small delay between multiple draws to avoid rate limits
        if (pendingDraws.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

async function sendCountdown() {
    const { buildCountdownEmbed } = require('../ui/embeds');
    const channelId = getConfigValue('announcementChannelId', defaults.announcementChannelId);
    if (!channelId || !clientRef) return;

    try {
        const channel = await clientRef.channels.fetch(channelId);
        if (!channel) return;
        const countdownMinutes = parseInt(getConfigValue('countdownMinutes', defaults.countdownMinutes), 10);
        const embed = buildCountdownEmbed(countdownMinutes);
        await channel.send({ embeds: [embed] });
        console.log('[SCHEDULER] Countdown sent');
    } catch (err) {
        console.error('[SCHEDULER] Failed to send countdown:', err.message);
    }
}

/**
 * Execute a draw for a specific date.
 * @param {string} dateStr - YYYY-MM-DD
 */
async function executeDrawForDate(dateStr) {
    const { performDailyDraw } = require('./drawEngine');
    const channelId = getConfigValue('announcementChannelId', defaults.announcementChannelId);
    const adminChannelId = getConfigValue('adminChannelId', defaults.adminChannelId);

    if (!clientRef) return;

    try {
        const result = performDailyDraw(dateStr);

        if (!result) {
            console.log(`[SCHEDULER] No confirmed ranking for ${dateStr}, skipping`);
            if (adminChannelId) {
                const ch = await clientRef.channels.fetch(adminChannelId);
                if (ch) await ch.send(`**No confirmed ranking for ${dateStr}.** Draw skipped.`);
            }
            return;
        }

        // Post announcement
        if (channelId) {
            const { buildResultEmbed } = require('../ui/embeds');
            const channel = await clientRef.channels.fetch(channelId);
            if (channel) {
                await channel.send({ embeds: [buildResultEmbed(result)] });
            }
        }

        // Post admin debug
        if (adminChannelId) {
            const { buildAdminResultEmbed } = require('../ui/embeds');
            const adminChannel = await clientRef.channels.fetch(adminChannelId);
            if (adminChannel) {
                await adminChannel.send({ embeds: [buildAdminResultEmbed(result)] });
            }
        }

        console.log(`[SCHEDULER] Draw for ${dateStr} complete: Train=${result.trainWinner?.name}, VIP=${result.vipWinner?.name}`);
    } catch (err) {
        console.error(`[SCHEDULER] Draw for ${dateStr} failed:`, err);
        if (adminChannelId) {
            try {
                const ch = await clientRef.channels.fetch(adminChannelId);
                if (ch) await ch.send(`**Draw for ${dateStr} failed!** Error: ${err.message}`);
            } catch (_) { /* ignore */ }
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

function getNextDrawTime() {
    if (drawJob && drawJob.nextInvocation()) {
        return drawJob.nextInvocation().toDate();
    }
    return null;
}

module.exports = { initScheduler, reschedule, executeDrawForDate, scheduleOneDraw, getNextDrawTime };
