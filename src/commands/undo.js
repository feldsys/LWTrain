const {
    SlashCommandBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    EmbedBuilder,
} = require('discord.js');
const { getDb } = require('../database/connection');
const { getDrawsForDate } = require('../database/queries');
const { performUndo } = require('../lottery/undoEngine');
const { buildErrorEmbed } = require('../ui/embeds');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-undo')
        .setDescription('Undo a completed draw (restores pity, removes the date entirely)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        // Find distinct draw dates in the last 14 days
        const db = getDb();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const rows = db.prepare(
            `SELECT DISTINCT date FROM draw_history WHERE date >= ? ORDER BY date DESC LIMIT 25`
        ).all(cutoffStr);

        if (rows.length === 0) {
            return interaction.reply({
                embeds: [buildErrorEmbed('No Draws to Undo', 'No draws found in the last 14 days.')],
                flags: 64,
            });
        }

        const options = rows.map(r => {
            const draws = getDrawsForDate(r.date);
            const train = draws.find(d => d.draw_type === 'train');
            const vip = draws.find(d => d.draw_type === 'vip');
            const weekday = WEEKDAYS[new Date(r.date + 'T12:00:00').getDay()];
            const winners = [
                train ? `Train: ${train.winner_name}` : null,
                vip ? `VIP: ${vip.winner_name}` : null,
            ].filter(Boolean).join(' | ');
            return {
                label: `${weekday} (${r.date})`,
                value: r.date,
                description: winners.slice(0, 100) || 'No winners recorded',
            };
        });

        const menu = new StringSelectMenuBuilder()
            .setCustomId('undo_select_date')
            .setPlaceholder('Which draw to undo?')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the draw you want to undo. **This will restore pity, delete the draw history, and remove the ranking entirely** so you can paste a new one.',
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: 64,
        });

        try {
            const filter = i => i.user.id === interaction.user.id &&
                (i.customId === 'undo_select_date' || i.customId.startsWith('undo_confirm_') || i.customId === 'undo_cancel');
            const selection = await interaction.channel.awaitMessageComponent({ filter, time: 60_000 });

            if (selection.customId !== 'undo_select_date') return;

            const dateStr = selection.values[0];
            const draws = getDrawsForDate(dateStr);
            const train = draws.find(d => d.draw_type === 'train');
            const vip = draws.find(d => d.draw_type === 'vip');
            const weekday = WEEKDAYS[new Date(dateStr + 'T12:00:00').getDay()];

            const preview = new EmbedBuilder()
                .setTitle(`Undo draw for ${weekday} (${dateStr})?`)
                .setColor(0xff9900)
                .setDescription([
                    train ? `**Train winner:** ${train.winner_name} (Rank #${train.winner_rank}, ${train.winner_points} pts)` : '*No train winner*',
                    vip ? `**VIP winner:** ${vip.winner_name} (Rank #${vip.winner_rank}, ${vip.winner_points} pts)` : '*No VIP winner*',
                    '',
                    'This will:',
                    '• Restore pity counters & win totals for affected players',
                    '• Reset last-win dates to the previous winning day',
                    '• Delete the draw history and ranking for this date',
                    '• Remove the pending ranking so you can paste a new one',
                ].join('\n'));

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`undo_confirm_${dateStr}`).setLabel('Undo Draw').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('undo_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
            );

            await selection.update({ content: '', embeds: [preview], components: [buttons] });

            const confirm = await interaction.channel.awaitMessageComponent({ filter, time: 60_000 });

            if (confirm.customId === 'undo_cancel') {
                return confirm.update({ content: 'Cancelled.', embeds: [], components: [] });
            }

            const result = performUndo(dateStr);
            console.log(`[UNDO] ${dateStr} undone by ${interaction.user.tag}`);

            const summary = [
                `Undo complete for **${weekday} (${dateStr})**.`,
                result.trainWinner ? `Reverted train win: ${result.trainWinner.name}` : null,
                result.vipWinner ? `Reverted VIP win: ${result.vipWinner.name}` : null,
                `Pity adjustments for ${result.rankingsCount} ranked players reversed.`,
                'You can now paste a new ranking for this date.',
            ].filter(Boolean).join('\n');

            await confirm.update({ content: summary, embeds: [], components: [] });
        } catch (err) {
            if (err && err.code === 'InteractionCollectorError') {
                try { await interaction.editReply({ content: 'Timed out.', embeds: [], components: [] }); } catch { /* ignore */ }
                return;
            }
            console.error('[UNDO] Error:', err);
            try {
                await interaction.followUp({
                    embeds: [buildErrorEmbed('Undo Failed', err.message || 'Unknown error')],
                    flags: 64,
                });
            } catch { /* ignore */ }
        }
    },
};
