const { EmbedBuilder } = require('discord.js');

/**
 * Build a preview embed shown after parsing a ranking in the admin channel.
 *
 * @param {Array} parsedEntries  Entries enriched by weightCalculator (with
 *     trainPityMultiplier, trainEffectiveWeight, trainWinProbability, onTrainCooldown, etc.)
 * @param {Map|Object} playerData  Unused (kept for backward compat), player data is in entries
 * @param {Object} config  Merged configuration
 * @returns {EmbedBuilder}
 */
function buildPreviewEmbed(parsedEntries, playerData, config) {
    const today = new Date().toISOString().split('T')[0];

    // Build a fixed-width table inside a code block for alignment
    const header = padRight('Rk', 4)
        + padRight('Name', 20)
        + padRight('Pts', 8)
        + padRight('Pity', 6)
        + padRight('Mult', 7)
        + padRight('Weight', 9)
        + padRight('Prob%', 7)
        + 'CD';
    const separator = '-'.repeat(header.length);

    const rows = parsedEntries.map(e => {
        const pity = e.train_pity_counter || 0;
        const mult = e.trainPityMultiplier != null ? e.trainPityMultiplier.toFixed(2) : '-';
        const weight = e.trainEffectiveWeight != null ? e.trainEffectiveWeight.toFixed(1) : '-';
        const prob = e.trainWinProbability != null ? (e.trainWinProbability * 100).toFixed(2) : '-';
        const cd = e.onTrainCooldown ? 'YES' : 'no';

        return padRight(String(e.rank), 4)
            + padRight(truncate(e.name, 18), 20)
            + padRight(String(e.points), 8)
            + padRight(String(pity), 6)
            + padRight(mult, 7)
            + padRight(weight, 9)
            + padRight(prob, 7)
            + cd;
    });

    const table = '```\n' + header + '\n' + separator + '\n' + rows.join('\n') + '\n```';

    return new EmbedBuilder()
        .setTitle('Ranking Preview')
        .setDescription(`**Date:** ${today}\n**Players:** ${parsedEntries.length}\n\n${table}`)
        .setColor(0x0099ff)
        .setFooter({ text: 'Use the buttons below to confirm or cancel this ranking.' })
        .setTimestamp();
}

/**
 * Build the public announcement embed after a draw completes.
 *
 * @param {Object} drawResult  { date, trainWinner, vipWinner, rankings }
 * @returns {EmbedBuilder}
 */
function buildResultEmbed(drawResult) {
    const { date, trainWinner, vipWinner, rankings } = drawResult;

    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const drawDate = new Date(date + 'T12:00:00');
    const weekday = WEEKDAYS[drawDate.getDay()];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const diffDays = Math.round((drawDate - today) / 86400000);

    let dateHeader;
    if (diffDays === 0) {
        dateHeader = `\uD83D\uDCC5 **Today (${weekday})**`;
    } else if (diffDays === 1) {
        dateHeader = `\uD83D\uDCC5 **Tomorrow (${weekday})**`;
    } else if (diffDays > 1) {
        dateHeader = `\uD83D\uDCC5 **In ${diffDays} days \u2014 ${weekday}, ${date}**`;
    } else {
        dateHeader = `\uD83D\uDCC5 **${weekday}, ${date}**`;
    }

    const lines = [];
    lines.push(dateHeader);
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    // Train winner section
    if (trainWinner) {
        const hardPity = trainWinner.wasHardPity ? '\n\u26A1 **HARD PITY TRIGGERED!**' : '';
        const prob = (trainWinner.probability * 100).toFixed(1);
        const pityMsg = trainWinner.pity > 0
            ? `\n> _${trainWinner.pity} day${trainWinner.pity !== 1 ? 's' : ''} without a win \u2014 well deserved!_`
            : '';

        lines.push('');
        lines.push('\uD83D\uDE82 **A L L I A N C E   T R A I N** \uD83D\uDE82');
        lines.push('');
        lines.push(`\uD83C\uDFC6  **${trainWinner.name}**  \uD83C\uDFC6`);
        lines.push(`> Rank **#${trainWinner.rank}** \u2502 **${formatNumber(trainWinner.points)}** pts \u2502 ${prob}% chance${hardPity}${pityMsg}`);
    }

    lines.push('');
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    // VIP winner section
    if (vipWinner) {
        const hardPity = vipWinner.wasHardPity ? '\n\u26A1 **HARD PITY TRIGGERED!**' : '';
        const prob = (vipWinner.probability * 100).toFixed(1);

        lines.push('');
        lines.push('\uD83D\uDCBA **V I P   S E A T** \uD83D\uDCBA');
        lines.push('');
        lines.push(`\uD83C\uDF89  **${vipWinner.name}**  \uD83C\uDF89`);
        lines.push(`> Rank **#${vipWinner.rank}** \u2502 **${formatNumber(vipWinner.points)}** pts \u2502 ${prob}% chance${hardPity}`);
    }

    lines.push('');
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    // Rankings table
    if (rankings && rankings.length > 0) {
        const rankMedals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
        const top = rankings.slice(0, Math.min(rankings.length, 10));

        lines.push('');
        lines.push('\uD83D\uDCCA **Rankings**');
        lines.push('');

        for (const r of top) {
            const medal = r.rank <= 3 ? rankMedals[r.rank - 1] : `\`${padRight(String(r.rank), 2)}\``;
            const isTrainWinner = trainWinner && r.name === trainWinner.name;
            const isVipWinner = vipWinner && r.name === vipWinner.name;
            const tag = isTrainWinner ? ' \uD83D\uDE82' : (isVipWinner ? ' \uD83D\uDCBA' : '');
            const bar = makeProgressBar(r.points, rankings[0].points, 10);

            lines.push(`${medal} **${r.name}**${tag}  \u2502  ${bar}  **${formatNumber(r.points)}**`);
        }

        if (rankings.length > 10) {
            lines.push(`\n_...and ${rankings.length - 10} more participants_`);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('\uD83C\uDFB0  LOTTERY DRAW RESULT  \uD83C\uDFB0')
        .setDescription(lines.join('\n'))
        .setColor(0xffd700)
        .setFooter({ text: `${weekday} ${date}  \u2502  Participants: ${rankings?.length || 0}  \u2502  Good luck next time!` })
        .setTimestamp();

    return embed;
}

/**
 * Build the admin-only debug embed with full weight/probability data.
 *
 * @param {Object} drawResult  Full draw result including all player debug info
 * @returns {EmbedBuilder}
 */
function buildAdminResultEmbed(drawResult) {
    const { date, trainWinner, vipWinner, rankings } = drawResult;

    const embed = new EmbedBuilder()
        .setTitle('Draw Results (Admin Debug)')
        .setDescription(`Full debug info for **${date}**`)
        .setColor(0x00ff00)
        .setTimestamp();

    // Winners summary
    if (trainWinner) {
        embed.addFields({
            name: 'Train Winner',
            value: formatWinnerDebug(trainWinner),
            inline: true,
        });
    }
    if (vipWinner) {
        embed.addFields({
            name: 'VIP Winner',
            value: formatWinnerDebug(vipWinner),
            inline: true,
        });
    }

    // Full player debug table in code block(s)
    // Discord embeds have a 4096-char description limit and 1024-char field limit,
    // so we chunk the table across multiple fields if needed.
    if (rankings && rankings.length > 0) {
        const header = padRight('Rk', 4)
            + padRight('Name', 18)
            + padRight('Pts', 7)
            + padRight('Pity', 6)
            + padRight('Wt', 9)
            + padRight('Prob%', 7)
            + 'CD';
        const sep = '-'.repeat(header.length);

        const rows = rankings.map(r => {
            const pity = r.train_pity_counter != null ? r.train_pity_counter : '-';
            const wt = r.trainEffectiveWeight != null
                ? r.trainEffectiveWeight.toFixed(1)
                : (r.effective_weight != null ? r.effective_weight.toFixed(1) : '-');
            const prob = r.trainWinProbability != null
                ? (r.trainWinProbability * 100).toFixed(2)
                : (r.win_probability != null ? (r.win_probability * 100).toFixed(2) : '-');
            const cd = r.onTrainCooldown ? 'YES' : 'no';

            return padRight(String(r.rank), 4)
                + padRight(truncate(r.name, 16), 18)
                + padRight(String(r.points), 7)
                + padRight(String(pity), 6)
                + padRight(wt, 9)
                + padRight(prob, 7)
                + cd;
        });

        // Chunk rows into groups that fit within 1024-char field limit
        const chunks = chunkLines(rows, 900, header, sep);
        chunks.forEach((chunk, idx) => {
            embed.addFields({
                name: idx === 0 ? 'All Players' : `All Players (cont. ${idx + 1})`,
                value: chunk,
                inline: false,
            });
        });
    }

    return embed;
}

/**
 * Build a countdown embed.
 *
 * @param {number} minutes  Minutes until draw
 * @returns {EmbedBuilder}
 */
function buildCountdownEmbed(minutes) {
    const ticks = '\u23F3'.repeat(Math.min(minutes, 5));
    return new EmbedBuilder()
        .setTitle('\uD83D\uDD14  DRAW INCOMING  \uD83D\uDD14')
        .setDescription(
            `${ticks}\n\n`
            + `The lottery draw begins in **${minutes} minute${minutes !== 1 ? 's' : ''}**!\n\n`
            + `> _Who will ride the train today?_\n`
            + `> _Get ready..._`
        )
        .setColor(0xff6600)
        .setTimestamp();
}

/**
 * Build a generic error embed.
 *
 * @param {string} title
 * @param {string} description
 * @returns {EmbedBuilder}
 */
function buildErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xff0000)
        .setTimestamp();
}

// ─── Helpers ────────────────────────────────────────────────

function padRight(str, len) {
    if (str.length >= len) return str.slice(0, len);
    return str + ' '.repeat(len - str.length);
}

function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '\u2026';
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function makeProgressBar(value, max, length) {
    const filled = Math.round((value / max) * length);
    const empty = length - filled;
    return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatWinnerDebug(winner) {
    const hardPity = winner.wasHardPity ? ' **[HARD PITY]**' : '';
    return `**${winner.name}**${hardPity}\n`
        + `Rank: #${winner.rank}\n`
        + `Points: ${winner.points}\n`
        + `Pity counter: ${winner.pity}\n`
        + `Probability: ${(winner.probability * 100).toFixed(2)}%`;
}

/**
 * Split an array of table rows into code-block strings that fit under maxChars.
 */
function chunkLines(rows, maxChars, header, sep) {
    const chunks = [];
    let current = [];
    let currentLen = header.length + sep.length + 10; // account for ``` markers and newlines

    for (const row of rows) {
        if (currentLen + row.length + 1 > maxChars && current.length > 0) {
            chunks.push('```\n' + header + '\n' + sep + '\n' + current.join('\n') + '\n```');
            current = [];
            currentLen = header.length + sep.length + 10;
        }
        current.push(row);
        currentLen += row.length + 1;
    }

    if (current.length > 0) {
        chunks.push('```\n' + header + '\n' + sep + '\n' + current.join('\n') + '\n```');
    }

    return chunks;
}

/**
 * Build an announcement embed for an upcoming scheduled draw.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} weekday - Weekday name (e.g., "Monday")
 * @param {Date} drawTime - When the draw will execute
 * @returns {EmbedBuilder}
 */
function buildDrawAnnouncementEmbed(dateStr, weekday, drawTime) {
    const today = new Date().toISOString().split('T')[0];
    const isBackfill = dateStr !== today;
    const timestamp = drawTime ? `<t:${Math.floor(drawTime.getTime() / 1000)}:t>` : 'soon';
    const relativeTime = drawTime ? `<t:${Math.floor(drawTime.getTime() / 1000)}:R>` : '';

    const title = isBackfill
        ? `\uD83D\uDCC5  BACKFILL DRAW: ${weekday.toUpperCase()}  \uD83D\uDCC5`
        : `\uD83D\uDCC5  DRAW SCHEDULED  \uD83D\uDCC5`;

    const desc = isBackfill
        ? `A ranking for **${weekday} (${dateStr})** has been submitted!\n\n`
          + `\uD83D\uDD54 Draw at **${timestamp}** (${relativeTime})\n\n`
          + `> _Catching up on missed draws..._`
        : `Today's ranking has been confirmed!\n\n`
          + `\uD83D\uDD54 Draw at **${timestamp}** (${relativeTime})`;

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(isBackfill ? 0x9b59b6 : 0x3498db)
        .setTimestamp();
}

module.exports = {
    buildPreviewEmbed,
    buildResultEmbed,
    buildAdminResultEmbed,
    buildCountdownEmbed,
    buildErrorEmbed,
    buildDrawAnnouncementEmbed,
};
