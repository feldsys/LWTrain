const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
    confirmPendingRanking, getPendingRanking, deleteRankingsForDate,
    skipPendingRanking, getConfig, upsertPlayer, insertDailyRanking,
    replaceDailyRankings, savePendingRanking, getDrawsForDate,
} = require('../database/queries');
const { buildErrorEmbed, buildPreviewEmbed, buildDrawAnnouncementEmbed } = require('../ui/embeds');
const { buildConfirmCancelRow } = require('../ui/buttons');
const defaults = require('../../config/default');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        try {
            // Handle slash command autocomplete
            if (interaction.isAutocomplete()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (command && command.autocomplete) {
                    try {
                        await command.autocomplete(interaction);
                    } catch (err) {
                        console.error(`[AUTOCOMPLETE] /${interaction.commandName}:`, err.message);
                    }
                }
                return;
            }

            // Handle slash commands
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return;
                try {
                    await command.execute(interaction);
                } catch (err) {
                    console.error(`[CMD] Error in /${interaction.commandName}:`, err);
                    const reply = { embeds: [buildErrorEmbed('Command Error', err.message)], flags: 64 };
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(reply);
                    } else {
                        await interaction.reply(reply);
                    }
                }
                return;
            }

            // Handle select menu (date selection)
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId.startsWith('select_ranking_date_')) {
                    await handleRankingDateSelection(interaction);
                } else if (interaction.customId.startsWith('select_train_date_')) {
                    await handleTrainDateSelection(interaction);
                } else if (interaction.customId === 'redraw_source') {
                    await handleRedrawSourceSelect(interaction);
                } else if (interaction.customId.startsWith('redraw_target_')) {
                    await handleRedrawTargetSelect(interaction);
                }
                return;
            }

            // Handle buttons
            if (interaction.isButton()) {
                const customId = interaction.customId;
                if (customId.startsWith('confirm_ranking_')) {
                    await handleConfirmRanking(interaction);
                } else if (customId.startsWith('cancel_ranking_')) {
                    await handleCancelRanking(interaction);
                }
            }
        } catch (err) {
            if (err.code === 10062) {
                console.warn('[INTERACTION] Expired interaction, ignoring');
            } else {
                console.error('[INTERACTION] Unhandled error:', err.message);
            }
        }
    },
};

// ─── Step 1: Ranking Date Selection ───

async function handleRankingDateSelection(interaction) {
    const rankingDate = interaction.values[0];

    if (rankingDate === 'none') {
        return interaction.update({ content: 'No dates available. All recent dates are already used.', components: [] });
    }

    const rankingWeekday = WEEKDAYS[new Date(rankingDate + 'T12:00:00').getDay()];

    // Show Step 2: train date selection
    const { buildTrainDateSelectRow } = require('../ui/buttons');
    // Extract the original message ID from the customId
    const messageId = interaction.customId.replace('select_ranking_date_', '');
    const trainDateRow = buildTrainDateSelectRow(rankingDate, messageId);

    await interaction.update({
        content: `Ranking from **${rankingWeekday} (${rankingDate})**.\n**Step 2/2:** Which day should the train run?`,
        components: [trainDateRow],
    });
}

// ─── Step 2: Train Date Selection ───

async function handleTrainDateSelection(interaction) {
    // customId format: select_train_date_{rankingDate}_{messageId}
    const parts = interaction.customId.replace('select_train_date_', '').split('_');
    const rankingDate = parts[0];
    const messageId = parts[1];
    const trainDate = interaction.values[0];

    if (trainDate === 'none') {
        return interaction.update({ content: 'No dates available. All upcoming dates are already used.', components: [] });
    }

    const rankingWeekday = WEEKDAYS[new Date(rankingDate + 'T12:00:00').getDay()];
    const trainWeekday = WEEKDAYS[new Date(trainDate + 'T12:00:00').getDay()];

    // Fetch original ranking message and re-parse
    let rawText;
    try {
        const botMessage = interaction.message;
        const ref = botMessage.reference;
        if (ref && ref.messageId) {
            const originalMsg = await interaction.channel.messages.fetch(ref.messageId);
            rawText = originalMsg.content;
        }
    } catch (err) {
        console.error('[INTERACTION] Failed to fetch original message:', err.message);
    }

    if (!rawText) {
        return interaction.update({ content: 'Could not find the original ranking message. Please paste the ranking again.', components: [] });
    }

    const { parseRanking } = require('../lottery/parser');
    const { entries } = parseRanking(rawText);
    if (entries.length === 0) {
        return interaction.update({ content: 'Failed to re-parse the ranking. Please paste it again.', components: [] });
    }

    // Upsert players and calculate weights
    const playerData = new Map();
    for (const entry of entries) {
        const player = upsertPlayer(entry.name);
        playerData.set(entry.name, player);
    }

    const config = buildConfig();
    const entriesWithPlayerData = entries.map(e => {
        const player = playerData.get(e.name);
        return {
            player_id: player.id, name: e.name, rank: e.rank, points: e.points,
            train_pity_counter: player.train_pity_counter || 0,
            vip_pity_counter: player.vip_pity_counter || 0,
            last_train_win_date: player.last_train_win_date,
            last_vip_win_date: player.last_vip_win_date,
        };
    });

    let enrichedEntries;
    try {
        const { calculateWeights } = require('../lottery/weightCalculator');
        enrichedEntries = calculateWeights(entriesWithPlayerData, config);
    } catch (err) {
        console.error('[INTERACTION] Weight calculation failed:', err.message);
        enrichedEntries = entriesWithPlayerData.map(e => ({
            ...e, trainPityMultiplier: null, trainEffectiveWeight: null,
            trainWinProbability: null, onTrainCooldown: false,
        }));
    }

    // Save pending ranking: trainDate is the key, rankingDate is stored separately
    savePendingRanking(trainDate, rawText, JSON.stringify(entries), rankingDate);

    // Build preview
    const embed = buildPreviewEmbed(enrichedEntries, playerData, config);
    const { buildConfirmCancelRow } = require('../ui/buttons');
    const confirmRow = buildConfirmCancelRow(trainDate);

    await interaction.update({
        content: `Ranking from **${rankingWeekday} (${rankingDate})** \u2192 Train on **${trainWeekday} (${trainDate})**:`,
        embeds: [embed],
        components: [confirmRow],
    });
}

// ─── Confirm Handler ───

async function handleConfirmRanking(interaction) {
    const dateStr = interaction.customId.replace('confirm_ranking_', '');

    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ embeds: [buildErrorEmbed('Permission Denied', 'Only administrators can confirm rankings.')], flags: 64 });
    }

    const pending = getPendingRanking(dateStr);
    if (!pending) {
        return interaction.reply({ embeds: [buildErrorEmbed('Not Found', `No pending ranking for ${dateStr}.`)], flags: 64 });
    }
    if (pending.status === 'confirmed') {
        return interaction.reply({ embeds: [buildErrorEmbed('Already Confirmed', `Ranking for ${dateStr} was already confirmed.`)], flags: 64 });
    }
    if (pending.status === 'drawn') {
        return interaction.reply({ embeds: [buildErrorEmbed('Already Drawn', `Draw for ${dateStr} has already been completed.`)], flags: 64 });
    }

    // Confirm the ranking
    confirmPendingRanking(dateStr, interaction.user.id);

    // Store in daily_rankings (dedupes names that resolve to the same player).
    const parsed = JSON.parse(pending.parsed_json);
    const skippedDupes = replaceDailyRankings(dateStr, parsed);

    // Disable buttons
    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmed').setLabel('Confirmed').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('cancelled').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(true),
    );

    await interaction.update({ components: [disabledRow] });

    // Schedule the draw and send announcement
    const { scheduleOneDraw } = require('../lottery/scheduler');
    const drawTime = scheduleOneDraw(interaction.client, dateStr);
    const weekday = WEEKDAYS[new Date(dateStr + 'T12:00:00').getDay()];

    const drawTimestamp = drawTime ? `<t:${Math.floor(drawTime.getTime() / 1000)}:t>` : 'soon';

    let confirmMsg = `Ranking for **${weekday} (${dateStr})** confirmed by <@${interaction.user.id}>. Draw scheduled for ${drawTimestamp}.`;
    if (skippedDupes.length > 0) {
        const dupeList = skippedDupes.map(s => `\`${s.name}\` → ${s.canonical}`).join(', ');
        confirmMsg += `\n⚠️ ${skippedDupes.length} duplicate name(s) skipped (same player after merge): ${dupeList}`;
    }
    await interaction.followUp(confirmMsg);

    // Send announcement in the public channel
    const announcementId = getConfigValue('announcementChannelId', defaults.announcementChannelId);
    if (announcementId) {
        try {
            const channel = await interaction.client.channels.fetch(announcementId);
            if (channel) {
                const announcementEmbed = buildDrawAnnouncementEmbed(dateStr, weekday, drawTime);
                await channel.send({ embeds: [announcementEmbed] });
            }
        } catch (err) {
            console.error('[INTERACTION] Failed to send announcement:', err.message);
        }
    }

    console.log(`[RANKING] Confirmed for ${dateStr} (${weekday}) by ${interaction.user.tag}, draw at ${drawTime?.toISOString()}`);
}

// ─── Cancel Handler ───

async function handleCancelRanking(interaction) {
    const dateStr = interaction.customId.replace('cancel_ranking_', '');

    if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ embeds: [buildErrorEmbed('Permission Denied', 'Only administrators can cancel rankings.')], flags: 64 });
    }

    const pending = getPendingRanking(dateStr);
    if (!pending || pending.status === 'drawn') {
        return interaction.reply({ embeds: [buildErrorEmbed('Cannot Cancel', 'This ranking cannot be cancelled.')], flags: 64 });
    }

    deleteRankingsForDate(dateStr);
    skipPendingRanking(dateStr);

    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmed').setLabel('Confirm').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('cancelled').setLabel('Cancelled').setStyle(ButtonStyle.Danger).setDisabled(true),
    );

    await interaction.update({ components: [disabledRow] });
    await interaction.followUp(`Ranking for **${dateStr}** cancelled.`);
    console.log(`[RANKING] Cancelled for ${dateStr} by ${interaction.user.tag}`);
}

// ─── Redraw Handlers ───

async function handleRedrawSourceSelect(interaction) {
    const sourceDate = interaction.values[0];
    const sourceWeekday = WEEKDAYS[new Date(sourceDate + 'T12:00:00').getDay()];

    // Build target date dropdown: today + next 14 days
    const { StringSelectMenuBuilder } = require('discord.js');
    const options = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    for (let i = 0; i <= 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const weekday = WEEKDAYS[d.getDay()];

        const hasDrawn = getDrawsForDate(dateStr).length > 0;
        const marker = hasDrawn ? '\u2705 ' : '';
        const label = i === 0 ? `${marker}Today (${weekday})` : `${marker}${weekday} ${dateStr}`;
        const description = hasDrawn ? 'Draw already completed' : (i === 0 ? 'Current day' : `In ${i} day${i > 1 ? 's' : ''}`);

        options.push({ label, value: dateStr, description });
    }

    const targetMenu = new StringSelectMenuBuilder()
        .setCustomId(`redraw_target_${sourceDate}`)
        .setPlaceholder('Which day should this draw be for?')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(targetMenu);

    await interaction.update({
        content: `**Redraw** \u2014 Step 2/2: Reusing ranking from **${sourceWeekday} (${sourceDate})**.\nNow select the **target day** for this draw:`,
        components: [row],
    });
}

async function handleRedrawTargetSelect(interaction) {
    const sourceDate = interaction.customId.replace('redraw_target_', '');
    const targetDate = interaction.values[0];
    const sourceWeekday = WEEKDAYS[new Date(sourceDate + 'T12:00:00').getDay()];
    const targetWeekday = WEEKDAYS[new Date(targetDate + 'T12:00:00').getDay()];

    // Check target doesn't already have a draw
    const targetDraws = getDrawsForDate(targetDate);
    if (targetDraws.length > 0) {
        return interaction.update({
            content: `A draw for **${targetWeekday} (${targetDate})** already exists. Please choose a different day.`,
            components: [],
        });
    }

    // Get source ranking data
    const { getRankingsForDate, savePendingRanking } = require('../database/queries');
    const { getDb } = require('../database/connection');
    const db = getDb();

    let entries;
    const sourceRankings = getRankingsForDate(sourceDate);
    if (sourceRankings.length > 0) {
        entries = sourceRankings.map(r => ({ name: r.name, rank: r.rank, points: r.points }));
    } else {
        const { getPendingRanking } = require('../database/queries');
        const sourcePending = getPendingRanking(sourceDate);
        if (sourcePending && sourcePending.parsed_json) {
            entries = JSON.parse(sourcePending.parsed_json);
        }
    }

    if (!entries || entries.length === 0) {
        return interaction.update({
            content: `No ranking data found for **${sourceDate}**. The source ranking may have been deleted.`,
            components: [],
        });
    }

    // Save as pending for target date
    const rawText = `[REDRAW from ${sourceWeekday} ${sourceDate}]`;
    savePendingRanking(targetDate, rawText, JSON.stringify(entries));

    // Calculate preview
    const { calculateWeights } = require('../lottery/weightCalculator');
    const config = buildConfig();

    const enrichedEntries = entries.map(e => {
        const player = upsertPlayer(e.name);
        return {
            player_id: player.id, name: e.name, rank: e.rank, points: e.points,
            train_pity_counter: player.train_pity_counter || 0,
            vip_pity_counter: player.vip_pity_counter || 0,
            last_train_win_date: player.last_train_win_date,
            last_vip_win_date: player.last_vip_win_date,
        };
    });

    let weighted;
    try { weighted = calculateWeights(enrichedEntries, config); }
    catch { weighted = enrichedEntries; }

    const { buildPreviewEmbed } = require('../ui/embeds');
    const { buildConfirmCancelRow } = require('../ui/buttons');
    const embed = buildPreviewEmbed(weighted, null, config);
    const confirmRow = buildConfirmCancelRow(targetDate);

    await interaction.update({
        content: `**Redraw:** Reusing **${sourceWeekday} (${sourceDate})** ranking for **${targetWeekday} (${targetDate})**\n> _All pity counters, cooldowns, and fairness rules still apply._`,
        embeds: [embed],
        components: [confirmRow],
    });
}

// ─── Helpers ───

function getConfigValue(key, fallback) {
    try {
        const val = getConfig(key);
        return val !== undefined ? val : fallback;
    } catch {
        return fallback;
    }
}

function buildConfig() {
    return {
        trainPoolSize: parseInt(getConfigValue('trainPoolSize', defaults.trainPoolSize), 10),
        vipPoolSize: parseInt(getConfigValue('vipPoolSize', defaults.vipPoolSize), 10),
        trainCooldownDays: parseInt(getConfigValue('trainCooldownDays', defaults.trainCooldownDays), 10),
        pityCoefficient: parseFloat(getConfigValue('pityCoefficient', defaults.pityCoefficient)),
        pityExponent: parseFloat(getConfigValue('pityExponent', defaults.pityExponent)),
        hardPityThreshold: parseInt(getConfigValue('hardPityThreshold', defaults.hardPityThreshold), 10),
    };
}
