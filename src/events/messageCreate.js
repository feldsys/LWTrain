const { Events } = require('discord.js');
const { parseRanking } = require('../lottery/parser');
const { getConfig } = require('../database/queries');
const { buildErrorEmbed } = require('../ui/embeds');
const { buildRankingDateSelectRow } = require('../ui/buttons');
const defaults = require('../../config/default');

// Deduplicate: track recently processed message IDs
const processedMessages = new Set();

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

        // Use the message ID as unique identifier - no in-memory storage needed
        let warningText = `**${entries.length} players** parsed successfully.\n**Step 1/2:** Which day is this ranking from?`;
        if (errors.length > 0) {
            warningText += '\n\n**Warnings:**\n' + errors.map(e => `- ${e}`).join('\n');
        }

        const dateRow = buildRankingDateSelectRow(message.id);

        await message.reply({
            content: warningText,
            components: [dateRow],
        });
    },
};

function getConfigValue(key, fallback) {
    try {
        const val = getConfig(key);
        return val !== undefined ? val : fallback;
    } catch {
        return fallback;
    }
}
