const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDrawHistory } = require('../database/queries');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-history')
        .setDescription('View draw history')
        .addIntegerOption(opt =>
            opt.setName('days').setDescription('Number of days to look back (default: 7)').setRequired(false).setMinValue(1).setMaxValue(90))
        .addStringOption(opt =>
            opt.setName('type').setDescription('Filter by draw type').setRequired(false)
                .addChoices(
                    { name: 'All', value: 'all' },
                    { name: 'Train', value: 'train' },
                    { name: 'VIP', value: 'vip' },
                )),

    async execute(interaction) {
        const days = interaction.options.getInteger('days') ?? 7;
        const type = interaction.options.getString('type') ?? 'all';

        const history = getDrawHistory(days, type);

        if (history.length === 0) {
            return interaction.reply({ content: `No draws found in the last ${days} days.`, ephemeral: true });
        }

        const lines = history.map(h => {
            const icon = h.draw_type === 'train' ? '\u{1F682}' : '\u{1FA91}';
            const pity = h.was_hard_pity ? ' (HARD PITY)' : '';
            const prob = (h.win_probability * 100).toFixed(1);
            return `${icon} **${h.date}** - ${h.winner_name} (Rank #${h.winner_rank}, ${h.winner_points} pts, ${prob}% chance${pity})`;
        });

        // Chunk into embed fields if too long
        const chunks = [];
        let current = '';
        for (const line of lines) {
            if (current.length + line.length + 1 > 1024) {
                chunks.push(current);
                current = '';
            }
            current += (current ? '\n' : '') + line;
        }
        if (current) chunks.push(current);

        const embed = new EmbedBuilder()
            .setTitle(`Draw History (Last ${days} days)`)
            .setColor(0x0099ff);

        chunks.forEach((chunk, i) => {
            embed.addFields({ name: i === 0 ? 'Results' : '\u200b', value: chunk });
        });

        await interaction.reply({ embeds: [embed] });
    },
};
