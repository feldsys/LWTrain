/**
 * Ranking text parser.
 *
 * Accepts pasted ranking text in various formats and returns structured entries.
 *
 * Supported line formats:
 *   1. PlayerAlpha 12345      (rank with dot)
 *   1) PlayerAlpha 12345      (rank with paren)
 *   1  PlayerAlpha 12345      (rank without punctuation)
 *   PlayerAlpha 12345         (no rank number)
 *
 * Separators can be tabs or spaces. Player names may contain unicode and
 * internal spaces; the last whitespace-delimited token is always the point value.
 */

// Matches an optional leading rank number (digits followed by optional . or )),
// then the player name (everything up to the last whitespace-delimited number),
// then the points value.
//
// Capture groups:
//   1 - rank number (optional)
//   2 - player name
//   3 - points
const RANKING_LINE_RE =
    /^\s*(?:(\d+)\s*[.)]\s*|\s*(\d+)\s+)?(.+?)[\s\t]+(\d+)\s*$/;

/**
 * Parse ranking text into structured entries.
 *
 * @param {string} text  Raw ranking text (multi-line)
 * @returns {{ entries: Array<{rank: number, name: string, points: number}>, errors: string[] }}
 */
function parseRanking(text) {
    if (!text || typeof text !== 'string') {
        return { entries: [], errors: ['No text provided'] };
    }

    const lines = text.split(/\r?\n/);
    const entries = [];
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        // Skip blank lines
        if (trimmed.length === 0) continue;

        // Skip common header / separator lines
        if (isHeaderLine(trimmed)) continue;

        const match = trimmed.match(RANKING_LINE_RE);
        if (!match) {
            errors.push(`Line ${i + 1}: Could not parse "${trimmed}"`);
            continue;
        }

        // Group 1 = rank with punctuation (e.g. "1." or "1)")
        // Group 2 = rank without punctuation (e.g. bare "1 ")
        // Group 3 = player name
        // Group 4 = points
        const rankStr = match[1] || match[2] || null;
        const name = match[3].trim();
        const points = parseInt(match[4], 10);

        if (!name) {
            errors.push(`Line ${i + 1}: Empty player name in "${trimmed}"`);
            continue;
        }

        if (isNaN(points)) {
            errors.push(`Line ${i + 1}: Invalid points value in "${trimmed}"`);
            continue;
        }

        entries.push({
            rank: rankStr ? parseInt(rankStr, 10) : null,
            name,
            points,
        });
    }

    // Auto-assign sequential ranks where missing
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].rank === null) {
            entries[i].rank = i + 1;
        }
    }

    return { entries, errors };
}

/**
 * Heuristic: detect header or separator lines that should be skipped.
 */
function isHeaderLine(line) {
    // Lines that are only dashes, equals, or other separator characters
    if (/^[-=_~*#]+$/.test(line)) return true;

    // Lines containing common header keywords but no digits (so not a real entry)
    const lower = line.toLowerCase();
    const headerKeywords = ['rank', 'name', 'player', 'points', 'score', 'pos', '#'];
    const hasKeyword = headerKeywords.some(kw => lower.includes(kw));
    const hasDigit = /\d/.test(line);
    if (hasKeyword && !hasDigit) return true;

    return false;
}

module.exports = { parseRanking };
