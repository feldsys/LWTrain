const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDrawHistory, getPendingRanking } = require('../database/queries');
const { getDb } = require('../database/connection');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-plan')
        .setDescription('Show the upcoming train & VIP schedule')
        .addIntegerOption(opt =>
            opt.setName('days')
                .setDescription('How many days to show (default: 14)')
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(30)),

    async execute(interaction) {
        const days = interaction.options.getInteger('days') ?? 14;
        const today = new Date();
        today.setHours(12, 0, 0, 0);

        // Fetch all draws for the range (past 3 days + future days)
        const db = getDb();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 3);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const draws = db.prepare(`
            SELECT date, draw_type, winner_name, winner_rank, winner_points
            FROM draw_history
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC, draw_type ASC
        `).all(startStr, endStr);

        // Group draws by date
        const drawsByDate = new Map();
        for (const d of draws) {
            if (!drawsByDate.has(d.date)) drawsByDate.set(d.date, {});
            drawsByDate.get(d.date)[d.draw_type] = d;
        }

        // Also check for pending/confirmed rankings without draws yet
        const pendingDates = new Set();
        const allPending = db.prepare(`
            SELECT date, status FROM pending_rankings
            WHERE date >= ? AND date <= ? AND status IN ('pending', 'confirmed')
        `).all(startStr, endStr);
        for (const p of allPending) pendingDates.add(p.date);

        // Build the schedule
        const lines = [];
        const totalDays = days + 3; // 3 past + future
        let hasAnyContent = false;

        for (let i = -3; i <= days; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            const weekday = WEEKDAYS[d.getDay()];
            const isToday = i === 0;
            const isPast = i < 0;

            const dayData = drawsByDate.get(dateStr);
            const hasPending = pendingDates.has(dateStr);

            // Skip past days without data
            if (isPast && !dayData && !hasPending) continue;

            hasAnyContent = true;
            const dayMarker = isToday ? '\u25B6\uFE0F' : (isPast ? '\u2B1C' : '\u2B1B');
            const dateLabel = isToday
                ? `**TODAY \u2014 ${weekday}**`
                : (isPast ? `~~${weekday} ${dateStr}~~` : `**${weekday}** ${dateStr}`);

            if (dayData) {
                const train = dayData.train;
                const vip = dayData.vip;
                const trainStr = train ? `\uD83D\uDE82 **${train.winner_name}**` : '\uD83D\uDE82 _none_';
                const vipStr = vip ? `\uD83D\uDCBA **${vip.winner_name}**` : '\uD83D\uDCBA _none_';

                lines.push(`${dayMarker} ${dateLabel}`);
                lines.push(`\u2003 ${trainStr}  \u2502  ${vipStr}`);
            } else if (hasPending) {
                lines.push(`${dayMarker} ${dateLabel}`);
                lines.push(`\u2003 \u23F3 _Draw pending..._`);
            } else {
                lines.push(`${dayMarker} ${dateLabel}`);
                lines.push(`\u2003 \u2796 _No ranking submitted_`);
            }

            lines.push('');
        }

        if (!hasAnyContent) {
            lines.push('_No draws scheduled. Submit a ranking to get started!_');
        }

        const embed = new EmbedBuilder()
            .setTitle('\uD83D\uDCC5  TRAIN SCHEDULE  \uD83D\uDCC5')
            .setDescription(lines.join('\n'))
            .setColor(0x3498db)
            .setFooter({ text: `Showing ${days} days ahead  \u2502  Use /plan days:30 for more` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
