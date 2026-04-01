const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPlayer, getAllPlayers, getPlayerDrawHistory } = require('../database/queries');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-stats')
        .setDescription('View player statistics')
        .addStringOption(opt =>
            opt.setName('player').setDescription('Player name (leave empty for leaderboard)').setRequired(false)),

    async execute(interaction) {
        const playerName = interaction.options.getString('player');

        if (playerName) {
            await showPlayerStats(interaction, playerName);
        } else {
            await showLeaderboard(interaction);
        }
    },
};

async function showPlayerStats(interaction, name) {
    const player = getPlayer(name);
    if (!player) {
        return interaction.reply({ content: `Player "${name}" not found.`, ephemeral: true });
    }

    const wins = getPlayerDrawHistory(player.id);
    const recentWins = wins.slice(0, 5);

    const embed = new EmbedBuilder()
        .setTitle(`Stats: ${player.name}`)
        .setColor(0x0099ff)
        .addFields(
            { name: 'Total Participations', value: `${player.total_participations}`, inline: true },
            { name: 'Train Wins', value: `${player.total_train_wins}`, inline: true },
            { name: 'VIP Wins', value: `${player.total_vip_wins}`, inline: true },
            { name: 'Train Pity Counter', value: `${player.train_pity_counter}`, inline: true },
            { name: 'VIP Pity Counter', value: `${player.vip_pity_counter}`, inline: true },
            { name: 'Last Train Win', value: player.last_train_win_date || 'Never', inline: true },
            { name: 'Last VIP Win', value: player.last_vip_win_date || 'Never', inline: true },
        );

    if (recentWins.length > 0) {
        const winLines = recentWins.map(w => {
            const icon = w.draw_type === 'train' ? '\u{1F682}' : '\u{1FA91}';
            return `${icon} ${w.date} - ${(w.win_probability * 100).toFixed(1)}% chance`;
        });
        embed.addFields({ name: 'Recent Wins', value: winLines.join('\n') });
    }

    await interaction.reply({ embeds: [embed] });
}

async function showLeaderboard(interaction) {
    const players = getAllPlayers();
    if (players.length === 0) {
        return interaction.reply({ content: 'No players registered yet.', ephemeral: true });
    }

    // Sort by total wins descending
    const sorted = [...players].sort((a, b) =>
        (b.total_train_wins + b.total_vip_wins) - (a.total_train_wins + a.total_vip_wins)
    );

    const top = sorted.slice(0, 15);
    const lines = top.map((p, i) => {
        const totalWins = p.total_train_wins + p.total_vip_wins;
        const pityInfo = p.train_pity_counter > 0 ? ` (pity: ${p.train_pity_counter})` : '';
        return `**${i + 1}.** ${p.name} - ${totalWins} wins (${p.total_train_wins}T/${p.total_vip_wins}V)${pityInfo}`;
    });

    const embed = new EmbedBuilder()
        .setTitle('Lottery Leaderboard')
        .setColor(0xffd700)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${players.length} players total | Use /stats <name> for details` });

    await interaction.reply({ embeds: [embed] });
}
