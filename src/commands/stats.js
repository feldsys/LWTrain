const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    resolvePlayer, getAllPlayers, getAllPlayersWithAliases, getPlayerDrawHistory,
} = require('../database/queries');
const { findCandidates } = require('../lottery/nameMatcher');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-stats')
        .setDescription('View player statistics')
        .addStringOption(opt =>
            opt.setName('player').setDescription('Player name (type part of it for suggestions; empty for leaderboard)').setRequired(false).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const players = getAllPlayersWithAliases();

        // Suggest player names plus each alias (shown as "alias → canonical"),
        // both resolving to the canonical player name.
        const choices = [];
        for (const p of players) {
            choices.push({ name: p.name, value: p.name });
            for (const a of p.aliases) choices.push({ name: `${a} → ${p.name}`, value: p.name });
        }

        const matches = (focused
            ? choices.filter(c => c.name.toLowerCase().includes(focused))
            : choices
        ).slice(0, 25);

        await interaction.respond(matches.map(c => ({
            name: trunc(c.name, 100),
            value: trunc(c.value, 100),
        })));
    },

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
    // Exact name/alias first, then a unique case-insensitive partial match.
    const player = resolvePlayer(name) || findByPartial(name);
    if (!player) {
        const suggestions = suggestNames(name);
        const hint = suggestions.length
            ? ` Did you mean: ${suggestions.join(', ')}?`
            : ' Start typing and pick from the suggestions.';
        return interaction.reply({ content: `Player "${name}" not found.${hint}`, flags: 64 });
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
        return interaction.reply({ content: 'No players registered yet.', flags: 64 });
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

// ─── Helpers ───

// A single case-insensitive substring match across names + aliases (null if 0 or >1).
function findByPartial(input) {
    const q = (input || '').toLowerCase().trim();
    if (!q) return null;
    const players = getAllPlayersWithAliases();
    const matches = players.filter(p =>
        p.name.toLowerCase().includes(q) || p.aliases.some(a => a.toLowerCase().includes(q))
    );
    return matches.length === 1 ? matches[0] : null;
}

// Up to 5 closest player names, for a "did you mean …?" hint.
function suggestNames(input) {
    const players = getAllPlayersWithAliases();
    return findCandidates(input || '', players, { limit: 5, floor: 0.4 }).map(c => c.player.name);
}
