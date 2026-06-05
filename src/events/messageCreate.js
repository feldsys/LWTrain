const {
    Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const { parseRanking } = require('../lottery/parser');
const {
    getConfig, resolvePlayer, getAllPlayersWithAliases, addAlias,
} = require('../database/queries');
const { findCandidates } = require('../lottery/nameMatcher');
const { buildErrorEmbed } = require('../ui/embeds');
const { buildRankingDateSelectRow } = require('../ui/buttons');
const defaults = require('../../config/default');

// Deduplicate: track recently processed message IDs
const processedMessages = new Set();

// Discord field limits
const MAX_OPT_LABEL = 100;
const MAX_OPT_DESC = 100;
const MAX_PLACEHOLDER = 150;
const RECON_PAGE_SIZE = 4;       // dropdowns per page (5th row reserved for buttons)
const ROSTER_BROWSE_SIZE = 25;   // players per page in the full-roster picker
const RECON_TIMEOUT_MS = 180_000;

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

        // Skip if already processed (Discord can send duplicates)
        if (processedMessages.has(message.id)) return;
        processedMessages.add(message.id);
        // Clean up old entries after 60 seconds
        setTimeout(() => processedMessages.delete(message.id), 60000);

        const adminChannelId = getConfigValue('adminChannelId', defaults.adminChannelId);
        if (!adminChannelId || message.channel.id !== adminChannelId) return;

        const text = message.content;
        if (!text || text.trim().length === 0) return;

        const { entries, errors } = parseRanking(text);

        const minPlayers = parseInt(
            getConfigValue('minPlayersForDraw', defaults.minPlayersForDraw), 10
        );

        if (entries.length < minPlayers) {
            // Not enough entries - only show error if it looked like a ranking attempt
            // (has at least 1 entry or has numbers in the text)
            if (entries.length === 0 && !/\d{3,}/.test(text)) return; // Ignore non-ranking messages

            const description = entries.length === 0
                ? 'No valid ranking entries found in the message.'
                : `Only ${entries.length} player(s) found (minimum ${minPlayers} required).`;
            const errorLines = errors.length > 0
                ? '\n\n**Parse errors:**\n' + errors.map(e => `- ${e}`).join('\n')
                : '';
            await message.reply({ embeds: [buildErrorEmbed('Ranking Parse Failed', description + errorLines)] });
            return;
        }

        let warningText = `**${entries.length} players** parsed successfully.\n**Step 1/2:** Which day is this ranking from?`;
        if (errors.length > 0) {
            warningText += '\n\n**Warnings:**\n' + errors.map(e => `- ${e}`).join('\n');
        }

        // ─── Name reconciliation ───
        // Detect names that don't map to a known player (directly or via alias).
        // The admin must classify each as "new player" or "alias of <existing>"
        // before we proceed to date selection, so OCR/spelling variants don't
        // silently create duplicate players.
        const unknownNames = collectUnknownNames(entries);

        if (unknownNames.length === 0) {
            await message.reply({ content: warningText, components: [buildRankingDateSelectRow(message.id)] });
            return;
        }

        await runReconciliation(message, unknownNames, warningText);
    },
};

// Unique (case-insensitive) list of parsed names that resolve to no known player.
function collectUnknownNames(entries) {
    const seen = new Set();
    const unknown = [];
    for (const e of entries) {
        const key = e.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!resolvePlayer(e.name)) unknown.push(e.name);
    }
    return unknown;
}

/**
 * Interactive reconciliation of unknown names. Shows a dropdown per unknown name
 * (new player + closest existing matches), persists chosen aliases, then hands
 * off to the normal date-selection flow on the same message.
 */
async function runReconciliation(message, unknownNames, warningText) {
    const players = getAllPlayersWithAliases();
    const playerNameById = new Map(players.map(p => [String(p.id), p.name]));

    // Precompute suggestion lists. Fall back to the two nearest players (any
    // score) when nothing clears the threshold, so the admin can always override.
    const candidatesByName = new Map();
    for (const name of unknownNames) {
        let cands = findCandidates(name, players, { limit: 4, floor: 0.45 });
        if (cands.length === 0 && players.length > 0) {
            cands = findCandidates(name, players, { limit: 2, floor: 0 });
        }
        candidatesByName.set(name, cands);
    }

    // decision: name -> 'new' | '<playerId>'
    const decisions = new Map(unknownNames.map(n => [n, 'new']));
    const rosterEmpty = players.length === 0;
    const pages = rosterEmpty ? [] : chunk(unknownNames, RECON_PAGE_SIZE);
    let page = 0;
    // When set, we're browsing the full roster to map this specific name.
    let browsing = null;
    let browsePage = 0;
    const rosterPages = Math.max(1, Math.ceil(players.length / ROSTER_BROWSE_SIZE));

    const render = () => {
        if (rosterEmpty) return renderEmptyRoster(unknownNames);
        if (browsing !== null) return renderBrowse(players, browsing, browsePage);
        return renderPage(pages, page, candidatesByName, decisions, playerNameById, unknownNames);
    };

    const initial = render();
    const botReply = await message.reply(initial);

    const collector = botReply.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: RECON_TIMEOUT_MS,
    });

    const applyAndProceed = async (interaction) => {
        for (const [name, val] of decisions) {
            if (val !== 'new') addAlias(name, Number(val));
        }
        collector.stop('applied');
        await interaction.update({ content: warningText, components: [buildRankingDateSelectRow(message.id)] });
    };

    collector.on('collect', async (interaction) => {
        try {
            const id = interaction.customId;
            if (id.startsWith('recon_pick_')) {
                const [, , pageStr, idxStr] = id.split('_');
                const name = pages[Number(pageStr)]?.[Number(idxStr)];
                if (name !== undefined) {
                    if (interaction.values[0] === '__browse__') {
                        browsing = name;
                        browsePage = 0;
                    } else {
                        decisions.set(name, interaction.values[0]);
                    }
                }
                await interaction.update(render());
            } else if (id === 'recon_browse') {
                if (browsing !== null) decisions.set(browsing, interaction.values[0]);
                browsing = null;
                await interaction.update(render());
            } else if (id === 'recon_browseback') {
                browsing = null;
                await interaction.update(render());
            } else if (id === 'recon_browseprev') {
                browsePage = Math.max(0, browsePage - 1);
                await interaction.update(render());
            } else if (id === 'recon_browsenext') {
                browsePage = Math.min(rosterPages - 1, browsePage + 1);
                await interaction.update(render());
            } else if (id === 'recon_prev') {
                page = Math.max(0, page - 1);
                await interaction.update(render());
            } else if (id === 'recon_next') {
                page = Math.min(pages.length - 1, page + 1);
                await interaction.update(render());
            } else if (id === 'recon_allnew') {
                for (const n of unknownNames) decisions.set(n, 'new');
                await applyAndProceed(interaction);
            } else if (id === 'recon_apply') {
                await applyAndProceed(interaction);
            } else if (id === 'recon_cancel') {
                collector.stop('cancel');
                await interaction.update({ content: 'Cancelled — nothing saved. Paste the ranking again to retry.', components: [] });
            }
        } catch (err) {
            if (err.code !== 10062) console.error('[RECON] collect error:', err.message);
        }
    });

    collector.on('end', async (_collected, reason) => {
        if (reason === 'applied' || reason === 'cancel') return;
        try {
            await botReply.edit({
                content: '⏱️ Reconciliation timed out — paste the ranking again to retry.',
                components: [],
            });
        } catch { /* message gone or already edited */ }
    });
}

// ─── Renderers ───

function renderEmptyRoster(unknownNames) {
    const content = `**${unknownNames.length} new player(s)** will be created (player database is currently empty):\n`
        + listNames(unknownNames, () => '🆕')
        + '\n\nProceed?';
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('recon_apply').setLabel('Create & continue').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('recon_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return { content, components: [row] };
}

function renderPage(pages, page, candidatesByName, decisions, playerNameById, unknownNames) {
    let content = `⚠️ **${unknownNames.length} unrecognized name(s)** in this ranking.\n`
        + 'Assign each one — **new player** or **alias of an existing player**:\n\n'
        + listNames(unknownNames, (n) => {
            const v = decisions.get(n);
            return v === 'new' ? '🆕 new' : `→ ${playerNameById.get(v) || `#${v}`}`;
        });

    if (pages.length > 1) {
        content += `\n\nPage **${page + 1}/${pages.length}** — use ◀ ▶ to assign all names.`;
    }
    content += '\n\n_Tip: "All new" creates every unrecognized name as a fresh player._';

    const rows = [];
    const pageNames = pages[page] || [];
    for (let k = 0; k < pageNames.length; k++) {
        const name = pageNames[k];
        const cur = decisions.get(name);
        const options = [{
            label: trunc('🆕 New player', MAX_OPT_LABEL),
            description: trunc(name, MAX_OPT_DESC),
            value: 'new',
            default: cur === 'new',
        }];
        for (const c of candidatesByName.get(name) || []) {
            const pct = Math.round(c.score * 100);
            const desc = c.matched !== c.player.name
                ? `matches alias "${c.matched}"`
                : `${c.player.total_participations || 0} entries · pity ${c.player.train_pity_counter || 0}`;
            options.push({
                label: trunc(`→ ${c.player.name} (${pct}%)`, MAX_OPT_LABEL),
                description: trunc(desc, MAX_OPT_DESC),
                value: String(c.player.id),
                default: cur === String(c.player.id),
            });
        }
        // A player chosen via the full-roster browser may not be among the
        // fuzzy candidates — surface it as a selected option so it stays visible.
        if (cur !== 'new' && !options.some(o => o.value === cur)) {
            options.push({
                label: trunc(`→ ${playerNameById.get(cur) || `#${cur}`}`, MAX_OPT_LABEL),
                description: 'chosen from full roster',
                value: cur,
                default: true,
            });
        }
        // Always offer the full-roster browser — for names that changed completely.
        options.push({
            label: '🔍 Choose existing player…',
            description: 'Browse the full roster (e.g. a completely changed name)',
            value: '__browse__',
            default: false,
        });

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`recon_pick_${page}_${k}`)
            .setPlaceholder(trunc(`Assign: ${name}`, MAX_PLACEHOLDER))
            .addOptions(options);
        rows.push(new ActionRowBuilder().addComponents(menu));
    }

    const controls = new ActionRowBuilder();
    if (pages.length > 1) {
        controls.addComponents(
            new ButtonBuilder().setCustomId('recon_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('recon_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
        );
    }
    controls.addComponents(
        new ButtonBuilder().setCustomId('recon_apply').setLabel('Apply & continue').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('recon_allnew').setLabel('All new').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('recon_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
    rows.push(controls);

    return { content: trunc(content, 2000), components: rows };
}

// Full-roster picker for one name — used when no fuzzy match fits (name changed
// completely). Lists every player alphabetically, 25 per page.
function renderBrowse(players, name, page) {
    const totalPages = Math.max(1, Math.ceil(players.length / ROSTER_BROWSE_SIZE));
    const p = Math.min(page, totalPages - 1);
    const slice = players.slice(p * ROSTER_BROWSE_SIZE, p * ROSTER_BROWSE_SIZE + ROSTER_BROWSE_SIZE);

    const options = slice.map(pl => ({
        label: trunc(pl.name, MAX_OPT_LABEL),
        description: trunc(
            `${pl.total_participations || 0} entries · pity ${pl.train_pity_counter || 0}`
            + (pl.aliases && pl.aliases.length ? ` · ${pl.aliases.length} alias(es)` : ''),
            MAX_OPT_DESC,
        ),
        value: String(pl.id),
    }));

    const menu = new StringSelectMenuBuilder()
        .setCustomId('recon_browse')
        .setPlaceholder(trunc(`Map "${name}" to an existing player`, MAX_PLACEHOLDER))
        .addOptions(options);

    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('recon_browseprev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
        new ButtonBuilder().setCustomId('recon_browsenext').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
        new ButtonBuilder().setCustomId('recon_browseback').setLabel('Back').setStyle(ButtonStyle.Primary),
    );

    const content = `Mapping \`${name}\` → pick the existing player it belongs to.\n`
        + `Page **${p + 1}/${totalPages}** (${players.length} players). Use ◀ ▶ to browse, **Back** to return.`;

    return { content, components: [new ActionRowBuilder().addComponents(menu), controls] };
}

// ─── Helpers ───

function listNames(names, labelFn, max = 25) {
    const shown = names.slice(0, max).map(n => `• \`${n}\` — ${labelFn(n)}`).join('\n');
    const extra = names.length > max ? `\n…and ${names.length - max} more` : '';
    return shown + extra;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function trunc(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function getConfigValue(key, fallback) {
    try {
        const val = getConfig(key);
        return val !== undefined ? val : fallback;
    } catch {
        return fallback;
    }
}
