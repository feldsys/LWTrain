const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getPlayer, resetPlayerPity } = require('../database/queries');
const { buildErrorEmbed } = require('../ui/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-reset-pity')
        .setDescription('Reset a player\'s pity counter')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('player').setDescription('Player name').setRequired(true))
        .addStringOption(opt =>
            opt.setName('type').setDescription('Which pity to reset').setRequired(false)
                .addChoices(
                    { name: 'Train', value: 'train' },
                    { name: 'VIP', value: 'vip' },
                    { name: 'Both', value: 'both' },
                )),

    async execute(interaction) {
        const name = interaction.options.getString('player');
        const type = interaction.options.getString('type') ?? 'both';

        const player = getPlayer(name);
        if (!player) {
            return interaction.reply({
                embeds: [buildErrorEmbed('Player Not Found', `No player named "${name}" found.`)],
                ephemeral: true,
            });
        }

        const oldTrain = player.train_pity_counter;
        const oldVip = player.vip_pity_counter;

        resetPlayerPity(player.id, type);

        const changes = [];
        if (type === 'train' || type === 'both') changes.push(`Train pity: ${oldTrain} -> 0`);
        if (type === 'vip' || type === 'both') changes.push(`VIP pity: ${oldVip} -> 0`);

        await interaction.reply(`Pity reset for **${player.name}**:\n${changes.join('\n')}`);
        console.log(`[ADMIN] Pity reset for ${player.name} (${type}) by ${interaction.user.tag}`);
    },
};
