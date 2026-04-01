const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig, getDrawsForDate } = require('../database/queries');
const { getDb } = require('../database/connection');
const { buildErrorEmbed } = require('../ui/embeds');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-redraw')
        .setDescription('Reuse a past ranking for a new draw (e.g., savings week)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        // Find past days that have rankings (last 14 days)
        const db = getDb();
        const today = new Date();
        today.setHours(12, 0, 0, 0);

        const pastDates = [];
        for (let i = 1; i <= 14; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];

            // Check if this date has rankings in daily_rankings or pending_rankings
            const hasRankings = db.prepare(
                'SELECT 1 FROM daily_rankings WHERE date = ? LIMIT 1'
            ).get(dateStr);
            const hasPending = db.prepare(
                'SELECT 1 FROM pending_rankings WHERE date = ? AND parsed_json IS NOT NULL LIMIT 1'
            ).get(dateStr);

            if (hasRankings || hasPending) {
                const weekday = WEEKDAYS[d.getDay()];
                const draws = getDrawsForDate(dateStr);
                const trainWinner = draws.find(dr => dr.draw_type === 'train');
                const desc = trainWinner
                    ? `Train: ${trainWinner.winner_name}`
                    : 'Ranking available';

                pastDates.push({
                    label: `${weekday} (${dateStr})`,
                    value: dateStr,
                    description: desc.slice(0, 100),
                });
            }
        }

        if (pastDates.length === 0) {
            return interaction.reply({
                embeds: [buildErrorEmbed('No Rankings Found', 'No past rankings found in the last 14 days.')],
                flags: 64,
            });
        }

        const sourceMenu = new StringSelectMenuBuilder()
            .setCustomId('redraw_source')
            .setPlaceholder('Which ranking do you want to reuse?')
            .addOptions(pastDates.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(sourceMenu);

        await interaction.reply({
            content: '**Redraw** \u2014 Step 1/2: Select the **source ranking** to reuse:',
            components: [row],
        });
    },
};
