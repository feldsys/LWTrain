const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { skipPendingRanking, getPendingRanking, deleteRankingsForDate } = require('../database/queries');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-skip')
        .setDescription('Skip today\'s draw')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('reason').setDescription('Reason for skipping').setRequired(false)),

    async execute(interaction) {
        const today = new Date().toISOString().split('T')[0];
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        const pending = getPendingRanking(today);
        if (pending && pending.status === 'drawn') {
            return interaction.reply({ content: `Today's draw has already been completed. Cannot skip.`, ephemeral: true });
        }

        if (pending) {
            deleteRankingsForDate(today);
            skipPendingRanking(today);
        }

        await interaction.reply(`Today's draw (**${today}**) has been skipped.\nReason: ${reason}`);
        console.log(`[ADMIN] Day skipped: ${today} - ${reason} (by ${interaction.user.tag})`);
    },
};
