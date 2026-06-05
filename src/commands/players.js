const {
    SlashCommandBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const { getAllPlayersWithAliases } = require('../database/queries');
const { findDuplicatePairs } = require('../lottery/nameMatcher');

const PAGE_SIZE = 20;
const TIMEOUT_MS = 120_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-players')
        .setDescription('List all main players (merged duplicates excluded) — overview of who still needs merging')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('sort')
                .setDescription('Sort order (default: name)')
                .setRequired(false)
                .addChoices(
                    { name: 'Name (A–Z)', value: 'name' },
                    { name: 'Entries', value: 'entries' },
                    { name: 'Wins', value: 'wins' },
                    { name: 'Pity', value: 'pity' },
                )),

    async execute(interaction) {
        const sort = interaction.options.getString('sort') || 'name';
        const players = sortPlayers(getAllPlayersWithAliases(), sort);

        if (players.length === 0) {
            return interaction.reply({ content: 'No players registered yet.', flags: 64 });
        }

        // Merged-away duplicates are deleted on merge, so this list already shows
        // only canonical players. Surface remaining look-alikes to merge next.
        const dupPairs = findDuplicatePairs(players, 0.6);
        const pages = Math.ceil(players.length / PAGE_SIZE);
        let page = 0;

        const render = () => buildView(players, page, pages, sort, dupPairs);

        await interaction.reply({ ...render(), flags: 64 });

        if (pages <= 1) return;

        const reply = await interaction.fetchReply();
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            time: TIMEOUT_MS,
        });

        collector.on('collect', async (i) => {
            try {
                if (i.customId === 'players_prev') page = Math.max(0, page - 1);
                else if (i.customId === 'players_next') page = Math.min(pages - 1, page + 1);
                await i.update(render());
            } catch (err) {
                if (err.code !== 10062) console.error('[PLAYERS] collect error:', err.message);
            }
        });

        collector.on('end', async () => {
            try { await interaction.editReply({ components: [] }); } catch { /* ignore */ }
        });
    },
};

function sortPlayers(players, sort) {
    const wins = p => (p.total_train_wins || 0) + (p.total_vip_wins || 0);
    const arr = [...players];
    switch (sort) {
        case 'entries': arr.sort((a, b) => (b.total_participations || 0) - (a.total_participations || 0)); break;
        case 'wins': arr.sort((a, b) => wins(b) - wins(a)); break;
        case 'pity': arr.sort((a, b) => (b.train_pity_counter || 0) - (a.train_pity_counter || 0)); break;
        default: arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    return arr;
}

function buildView(players, page, pages, sort, dupPairs) {
    const start = page * PAGE_SIZE;
    const slice = players.slice(start, start + PAGE_SIZE);

    const lines = slice.map((p, i) => `**${start + i + 1}.** ${playerLine(p)}`);
    const withAliases = players.filter(p => p.aliases.length > 0).length;

    const embed = new EmbedBuilder()
        .setTitle('Main Players')
        .setColor(0x0099ff)
        .setDescription(trunc(lines.join('\n'), 4096))
        .setFooter({
            text: `${players.length} players · ${withAliases} with aliases · sorted by ${sort}`
                + (pages > 1 ? ` · page ${page + 1}/${pages}` : ''),
        });

    if (dupPairs.length > 0) {
        const dupLines = dupPairs.slice(0, 10).map(d => `• ${d.a.name} ↔ ${d.b.name} (${Math.round(d.score * 100)}%)`);
        if (dupPairs.length > 10) dupLines.push(`…and ${dupPairs.length - 10} more`);
        embed.addFields({
            name: `⚠️ Possible duplicates (${dupPairs.length}) — clean up with /train-merge`,
            value: trunc(dupLines.join('\n'), 1024),
        });
    }

    const components = [];
    if (pages > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('players_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('players_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
        ));
    }

    return { embeds: [embed], components };
}

function playerLine(p) {
    const wins = (p.total_train_wins || 0) + (p.total_vip_wins || 0);
    const aliasPart = p.aliases.length ? ` · _aliases:_ ${p.aliases.join(', ')}` : '';
    const line = `${p.name} — ${p.total_participations || 0} entries · ${wins} wins `
        + `(${p.total_train_wins || 0}T/${p.total_vip_wins || 0}V) · pity ${p.train_pity_counter || 0}${aliasPart}`;
    return trunc(line, 280);
}

function trunc(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
