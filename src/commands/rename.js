const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getPlayer, resolvePlayer } = require('../database/queries');
const { buildErrorEmbed } = require('../ui/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-rename')
        .setDescription('Rename a player (keeps all stats, pity, and history)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('old-name')
                .setDescription('Current player name')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('new-name')
                .setDescription('New player name')
                .setRequired(true)),

    async execute(interaction) {
        const oldName = interaction.options.getString('old-name');
        const newName = interaction.options.getString('new-name');

        const player = getPlayer(oldName);
        if (!player) {
            return interaction.reply({
                embeds: [buildErrorEmbed('Player Not Found', `No player named **${oldName}** found.`)],
                flags: 64,
            });
        }

        // Check new name doesn't already exist as a player or as an alias of
        // another player (an alias of the same player is fine and gets cleaned up).
        const existing = resolvePlayer(newName);
        if (existing && existing.id !== player.id) {
            return interaction.reply({
                embeds: [buildErrorEmbed('Name Taken', `**${newName}** already belongs to another player (name or alias).`)],
                flags: 64,
            });
        }

        // Update player name and all denormalized references
        const db = require('../database/connection').getDb();
        const rename = db.transaction(() => {
            db.prepare('UPDATE players SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newName, player.id);
            db.prepare('UPDATE draw_history SET winner_name = ? WHERE winner_id = ?').run(newName, player.id);
        });
        rename();

        await interaction.reply(
            `\u2705 Player renamed: **${oldName}** \u2192 **${newName}**\n`
            + `> All stats, pity counters, and history preserved.`
        );
        console.log(`[RENAME] ${oldName} -> ${newName} by ${interaction.user.tag}`);
    },
};
