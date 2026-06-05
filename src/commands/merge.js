const {
    SlashCommandBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    EmbedBuilder,
} = require('discord.js');
const { resolvePlayer, getAllPlayersWithAliases } = require('../database/queries');
const { findDuplicatePairs } = require('../lottery/nameMatcher');
const { performMerge } = require('../lottery/mergeEngine');
const { buildErrorEmbed } = require('../ui/embeds');

const COLLECT_TIMEOUT_MS = 120_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-merge')
        .setDescription('Merge duplicate players into one (keeps stats, pity & history). No args = scan for duplicates.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('from').setDescription('Player to merge away (will be deleted, kept as alias)').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
            opt.setName('into').setDescription('Surviving player to keep').setRequired(false).setAutocomplete(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase().trim();
        const players = getAllPlayersWithAliases();

        // Suggest player names plus each alias (shown as "alias → canonical").
        const choices = [];
        for (const p of players) {
            choices.push({ name: p.name, value: p.name });
            for (const a of p.aliases) choices.push({ name: `${a} → ${p.name}`, value: a });
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
        const fromName = interaction.options.getString('from');
        const intoName = interaction.options.getString('into');

        if (fromName || intoName) {
            await runManualMerge(interaction, fromName, intoName);
        } else {
            await runScanner(interaction);
        }
    },
};

// ─── Manual merge: /train-merge from:<x> into:<y> ───

async function runManualMerge(interaction, fromName, intoName) {
    if (!fromName || !intoName) {
        return interaction.reply({
            embeds: [buildErrorEmbed('Missing Argument', 'Provide **both** `from` and `into`, or neither to scan for duplicates.')],
            flags: 64,
        });
    }

    const from = resolvePlayer(fromName);
    const into = resolvePlayer(intoName);
    if (!from) {
        return interaction.reply({ embeds: [buildErrorEmbed('Player Not Found', `No player or alias **${fromName}**.`)], flags: 64 });
    }
    if (!into) {
        return interaction.reply({ embeds: [buildErrorEmbed('Player Not Found', `No player or alias **${intoName}**.`)], flags: 64 });
    }
    if (from.id === into.id) {
        return interaction.reply({ embeds: [buildErrorEmbed('Already One Player', `**${fromName}** and **${intoName}** already resolve to the same player.`)], flags: 64 });
    }

    await interaction.reply({ embeds: [previewEmbed(from, into)], components: [confirmRow()], flags: 64 });
    await driveConfirm(interaction, { from, into });
}

// ─── Scanner: /train-merge (no args) ───

async function runScanner(interaction) {
    const players = getAllPlayersWithAliases();
    const pairs = findDuplicatePairs(players, 0.6).slice(0, 25);

    if (pairs.length === 0) {
        return interaction.reply({
            content: '✅ No likely-duplicate players found (similarity ≥ 60%). You can still merge manually with `/train-merge from: into:`.',
            flags: 64,
        });
    }

    const options = pairs.map((p, i) => ({
        label: trunc(`${p.a.name} ↔ ${p.b.name}`, 100),
        description: trunc(`${Math.round(p.score * 100)}% similar · ${p.a.total_participations || 0} vs ${p.b.total_participations || 0} entries`, 100),
        value: String(i),
    }));

    const menu = new StringSelectMenuBuilder()
        .setCustomId('merge_pick')
        .setPlaceholder(`Found ${pairs.length} possible duplicate pair(s)`)
        .addOptions(options);

    await interaction.reply({
        content: `Found **${pairs.length}** likely-duplicate pair(s). Select one to review and merge:`,
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: 64,
    });

    await driveConfirm(interaction, null, pairs);
}

/**
 * Shared collector loop. Handles pair selection (scanner), direction swap, and
 * the final merge/cancel for both entry points.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{from:object,into:object}|null} initialPair  Preselected pair (manual mode).
 * @param {Array|null} scanPairs  Scanner candidate pairs (scanner mode).
 */
async function driveConfirm(interaction, initialPair, scanPairs = null) {
    const reply = await interaction.fetchReply();
    let current = initialPair; // { from, into }

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: COLLECT_TIMEOUT_MS,
    });

    collector.on('collect', async (i) => {
        try {
            if (i.customId === 'merge_pick') {
                const pair = scanPairs[Number(i.values[0])];
                // Default: keep the player with more participations (tiebreak: more recent).
                current = orientPair(pair.a, pair.b);
                await i.update({ content: '', embeds: [previewEmbed(current.from, current.into)], components: [confirmRow()] });
            } else if (i.customId === 'merge_swap') {
                current = { from: current.into, into: current.from };
                await i.update({ embeds: [previewEmbed(current.from, current.into)], components: [confirmRow()] });
            } else if (i.customId === 'merge_go') {
                const result = performMerge(current.from.id, current.into.id);
                collector.stop('done');
                console.log(`[MERGE] ${result.fromName} -> ${result.intoName} by ${interaction.user.tag}`);
                const dropped = result.droppedRankingDates.length
                    ? `\n• Dropped ${result.droppedRankingDates.length} duplicate ranking day(s): ${result.droppedRankingDates.join(', ')}`
                    : '';
                await i.update({
                    content: `✅ Merged **${result.fromName}** into **${result.intoName}**.\n`
                        + `• ${result.movedRankings} ranking entries + ${result.movedDraws} draw win(s) repointed${dropped}\n`
                        + `• Pity kept from **${result.pitySource}**, lifetime stats summed\n`
                        + `• "${result.fromName}" is now an alias of **${result.intoName}**`,
                    embeds: [],
                    components: [],
                });
            } else if (i.customId === 'merge_cancel') {
                collector.stop('cancel');
                await i.update({ content: 'Cancelled — no players were merged.', embeds: [], components: [] });
            }
        } catch (err) {
            if (err.code === 10062) return;
            console.error('[MERGE] error:', err);
            try {
                await i.update({ embeds: [buildErrorEmbed('Merge Failed', err.message || 'Unknown error')], components: [] });
            } catch { /* ignore */ }
        }
    });

    collector.on('end', async (_c, reason) => {
        if (reason === 'done' || reason === 'cancel') return;
        try { await interaction.editReply({ content: '⏱️ Timed out.', embeds: [], components: [] }); } catch { /* ignore */ }
    });
}

// ─── UI helpers ───

function orientPair(a, b) {
    const aScore = (a.total_participations || 0);
    const bScore = (b.total_participations || 0);
    if (bScore > aScore) return { from: a, into: b };
    if (aScore > bScore) return { from: b, into: a };
    // tiebreak: keep the more recently updated as the survivor
    return (a.updated_at || '') >= (b.updated_at || '')
        ? { from: b, into: a }
        : { from: a, into: b };
}

function previewEmbed(from, into) {
    return new EmbedBuilder()
        .setTitle('Confirm player merge')
        .setColor(0xff9900)
        .setDescription([
            `**${from.name}** will be merged into **${into.name}**.`,
            '',
            `🟢 **Surviving:** ${into.name} (#${into.id}) — ${into.total_participations || 0} entries, ${into.total_train_wins || 0} train / ${into.total_vip_wins || 0} VIP wins`,
            `🔴 **Absorbed:** ${from.name} (#${from.id}) — ${from.total_participations || 0} entries, ${from.total_train_wins || 0} train / ${from.total_vip_wins || 0} VIP wins`,
            '',
            'Result:',
            '• Lifetime stats summed; pity kept from the most recently active record',
            '• All rankings & draw history repointed to the surviving player',
            `• "${from.name}" kept as an alias of **${into.name}**`,
            '',
            '⚠️ This cannot be undone. Use **Swap** to flip which player survives.',
        ].join('\n'));
}

function confirmRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('merge_go').setLabel('Merge').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('merge_swap').setLabel('Swap direction').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('merge_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
}

function trunc(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
