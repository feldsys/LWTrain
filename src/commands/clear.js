const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb } = require('../database/connection');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-clear')
        .setDescription('Delete ALL player data, rankings, and draw history')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const db = getDb();

        // Count existing data
        const players = db.prepare('SELECT COUNT(*) as c FROM players').get().c;
        const rankings = db.prepare('SELECT COUNT(*) as c FROM daily_rankings').get().c;
        const draws = db.prepare('SELECT COUNT(*) as c FROM draw_history').get().c;
        const pending = db.prepare('SELECT COUNT(*) as c FROM pending_rankings').get().c;

        if (players === 0 && rankings === 0 && draws === 0) {
            return interaction.reply({ content: 'Database is already empty.', flags: 64 });
        }

        await interaction.reply({
            content: `**\u26A0\uFE0F WARNING: This will permanently delete:**\n`
                + `> \uD83D\uDC64 **${players}** players (pity counters, win history)\n`
                + `> \uD83D\uDCCA **${rankings}** daily rankings\n`
                + `> \uD83C\uDFB0 **${draws}** draw results\n`
                + `> \uD83D\uDCCB **${pending}** pending rankings\n\n`
                + `**This cannot be undone!** Are you sure?`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('train_clear_confirm').setLabel('Yes, delete everything').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('train_clear_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                ),
            ],
        });

        try {
            const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('train_clear_');
            const response = await interaction.channel.awaitMessageComponent({ filter, time: 30_000 });

            if (response.customId === 'train_clear_confirm') {
                // Second confirmation
                await response.update({
                    content: '**\u{1F6A8} FINAL CONFIRMATION \u{1F6A8}**\nType the word below is your last chance to cancel.',
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('train_clear_final').setLabel('DELETE ALL DATA NOW').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId('train_clear_cancel2').setLabel('Cancel').setStyle(ButtonStyle.Success),
                        ),
                    ],
                });

                const response2 = await interaction.channel.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id && i.customId.startsWith('train_clear_'),
                    time: 15_000,
                });

                if (response2.customId === 'train_clear_final') {
                    db.exec(`
                        DELETE FROM daily_rankings;
                        DELETE FROM draw_history;
                        DELETE FROM pending_rankings;
                        DELETE FROM players;
                    `);

                    await response2.update({
                        content: '\u2705 **All data has been deleted.** The database is now empty.\nPity counters, rankings, draw history - everything reset.',
                        components: [],
                    });
                    console.log(`[CLEAR] All data deleted by ${interaction.user.tag}`);
                } else {
                    await response2.update({ content: 'Cancelled. No data was deleted.', components: [] });
                }
            } else {
                await response.update({ content: 'Cancelled. No data was deleted.', components: [] });
            }
        } catch {
            await interaction.editReply({ content: 'Timed out. No data was deleted.', components: [] });
        }
    },
};
