const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getPendingRanking, getDrawsForDate, getConfig } = require('../database/queries');
const { getDb } = require('../database/connection');
const { buildErrorEmbed, buildResultEmbed, buildAdminResultEmbed } = require('../ui/embeds');
const { performDailyDraw } = require('../lottery/drawEngine');
const defaults = require('../../config/default');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-draw')
        .setDescription('Manually trigger a draw')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        // Find all confirmed rankings that haven't been drawn yet
        const db = getDb();
        const pendingDraws = db.prepare(`
            SELECT pr.date, pr.status FROM pending_rankings pr
            WHERE pr.status = 'confirmed'
            AND NOT EXISTS (SELECT 1 FROM draw_history dh WHERE dh.date = pr.date)
            ORDER BY pr.date ASC
        `).all();

        if (pendingDraws.length === 0) {
            return interaction.reply({
                embeds: [buildErrorEmbed('No Pending Draws', 'No confirmed rankings waiting for a draw. Paste a ranking and confirm it first.')],
                flags: 64,
            });
        }

        if (pendingDraws.length === 1) {
            // Only one pending - ask for confirmation directly
            const dateStr = pendingDraws[0].date;
            const weekday = WEEKDAYS[new Date(dateStr + 'T12:00:00').getDay()];

            await interaction.reply({
                content: `Execute draw for **${weekday} (${dateStr})** now?`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`manual_draw_confirm_${dateStr}`).setLabel('Execute Draw').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`manual_draw_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                    ),
                ],
            });
        } else {
            // Multiple pending - show select menu
            const options = pendingDraws.map(p => {
                const weekday = WEEKDAYS[new Date(p.date + 'T12:00:00').getDay()];
                return {
                    label: `${weekday} (${p.date})`,
                    value: p.date,
                    description: 'Confirmed, waiting for draw',
                };
            });

            // Add "Draw All" option
            options.unshift({
                label: 'Draw ALL pending',
                value: 'all',
                description: `Execute all ${pendingDraws.length} pending draws sequentially`,
            });

            const menu = new StringSelectMenuBuilder()
                .setCustomId('manual_draw_select')
                .setPlaceholder('Which draw to execute?')
                .addOptions(options);

            await interaction.reply({
                content: `**${pendingDraws.length} pending draws** found. Which one to execute?`,
                components: [new ActionRowBuilder().addComponents(menu)],
            });
        }

        // Collect response
        try {
            const filter = i => i.user.id === interaction.user.id &&
                (i.customId.startsWith('manual_draw_') || i.customId === 'manual_draw_select');
            const response = await interaction.channel.awaitMessageComponent({ filter, time: 60_000 });

            if (response.customId === 'manual_draw_cancel') {
                return response.update({ content: 'Cancelled.', components: [] });
            }

            // Determine which dates to draw
            let datesToDraw = [];
            if (response.customId === 'manual_draw_select') {
                const selected = response.values[0];
                datesToDraw = selected === 'all'
                    ? pendingDraws.map(p => p.date)
                    : [selected];
            } else if (response.customId.startsWith('manual_draw_confirm_')) {
                datesToDraw = [response.customId.replace('manual_draw_confirm_', '')];
            }

            await response.update({ content: `Executing ${datesToDraw.length} draw(s)...`, components: [] });

            const announcementId = getConfig('announcementChannelId') || defaults.announcementChannelId;

            for (const dateStr of datesToDraw) {
                const weekday = WEEKDAYS[new Date(dateStr + 'T12:00:00').getDay()];

                try {
                    const result = performDailyDraw(dateStr);
                    if (!result) {
                        await interaction.followUp(`Draw for **${weekday} (${dateStr})** skipped - no valid data.`);
                        continue;
                    }

                    // Post to announcement channel
                    if (announcementId) {
                        const channel = await interaction.client.channels.fetch(announcementId);
                        if (channel) {
                            await channel.send({ embeds: [buildResultEmbed(result)] });
                        }
                    }

                    // Post debug in current channel
                    await interaction.followUp({ embeds: [buildAdminResultEmbed(result)] });
                    console.log(`[MANUAL-DRAW] ${dateStr} executed by ${interaction.user.tag}`);
                } catch (err) {
                    await interaction.followUp(`Draw for **${weekday} (${dateStr})** failed: ${err.message}`);
                    console.error(`[MANUAL-DRAW] ${dateStr} failed:`, err);
                }
            }
        } catch {
            await interaction.editReply({ content: 'Timed out.', components: [] });
        }
    },
};
