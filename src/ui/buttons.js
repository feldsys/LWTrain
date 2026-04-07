const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getUsedRankingDates, getUsedTrainDates } = require('../database/queries');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build dropdown for Step 1: "Which day is this ranking from?"
 * Shows last 7 days, excludes already used dates.
 */
function buildRankingDateSelectRow(interactionId) {
    const usedDates = getUsedRankingDates();
    const options = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    for (let offset = 0; offset >= -7; offset--) {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        const dateStr = d.toISOString().split('T')[0];
        const weekday = WEEKDAYS[d.getDay()];
        const used = usedDates.has(dateStr);

        if (used) continue; // Skip used dates entirely

        const label = offset === 0 ? `Today (${weekday})` : `${weekday} ${dateStr}`;
        const description = offset === 0 ? 'Current day' : `${Math.abs(offset)} day${Math.abs(offset) > 1 ? 's' : ''} ago`;

        options.push({ label, value: dateStr, description });
    }

    if (options.length === 0) {
        options.push({ label: 'No dates available', value: 'none', description: 'All recent dates are already used' });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_ranking_date_${interactionId}`)
        .setPlaceholder('Step 1: Which day is this ranking from?')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Build dropdown for Step 2: "Which day should the train run?"
 * Shows today + 14 days forward, excludes already used dates + the ranking date.
 */
function buildTrainDateSelectRow(rankingDate, interactionId) {
    const usedDates = getUsedTrainDates();
    usedDates.add(rankingDate); // Also exclude the ranking date just selected
    const options = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    for (let offset = 0; offset <= 14; offset++) {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        const dateStr = d.toISOString().split('T')[0];
        const weekday = WEEKDAYS[d.getDay()];
        const used = usedDates.has(dateStr);

        if (used) continue; // Skip used dates

        const label = offset === 0 ? `Today (${weekday})` : `${weekday} ${dateStr}`;
        const description = offset === 0 ? 'Current day' : `In ${offset} day${offset > 1 ? 's' : ''}`;

        options.push({ label, value: dateStr, description });
    }

    if (options.length === 0) {
        options.push({ label: 'No dates available', value: 'none', description: 'All upcoming dates are already used' });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_train_date_${rankingDate}_${interactionId}`)
        .setPlaceholder('Step 2: Which day should the train run?')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Build Confirm/Cancel buttons for a pending ranking.
 */
function buildConfirmCancelRow(dateStr) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_ranking_${dateStr}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_ranking_${dateStr}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
}

module.exports = { buildRankingDateSelectRow, buildTrainDateSelectRow, buildConfirmCancelRow };
