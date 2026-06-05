// ─── Name Matcher ───
// Fuzzy matching for player names. Player names pasted from screenshots/OCR
// frequently differ from the stored name by a tag, an emoji, a stray space, or
// a single mis-read character. These helpers normalize names and score their
// similarity so the bot can suggest "did you mean <existing player>?" instead of
// silently creating a duplicate.

// Strip alliance/clan tags, emojis and zero-width junk that commonly wrap a name.
function stripDecorations(s) {
    return String(s)
        .normalize('NFKC')
        // leading bracketed tag, e.g. "[ABC] Name", "(ABC) Name", "{ABC} Name"
        .replace(/^\s*[[({][^\])}]*[\])}]\s*/, '')
        // trailing bracketed tag
        .replace(/\s*[[({][^\])}]*[\])}]\s*$/, '')
        // zero-width characters (ZWSP, ZWNJ, ZWJ, BOM)
        .replace(/[​‌‍﻿]/g, '')
        // emoji & pictographs & variation selectors & symbol blocks
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
        .trim();
}

/** Lowercased, decoration-free, single-spaced form used for display/compare. */
function normalizeName(s) {
    return stripDecorations(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Spaceless form — "Player One" and "PlayerOne" compare as near-identical. */
function compactName(s) {
    return normalizeName(s).replace(/\s+/g, '');
}

/** Classic Levenshtein edit distance (iterative, single-row buffer). */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;

    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,        // deletion
                curr[j - 1] + 1,    // insertion
                prev[j - 1] + cost, // substitution
            );
        }
        prev = curr;
    }
    return prev[b.length];
}

/**
 * Similarity of two names in [0, 1] (1 = identical after normalization).
 * Compares the spaceless/normalized forms so tags and spacing don't dominate.
 */
function similarity(a, b) {
    const x = compactName(a);
    const y = compactName(b);
    if (!x.length && !y.length) return 1;
    if (!x.length || !y.length) return 0;
    if (x === y) return 1;
    const dist = levenshtein(x, y);
    return 1 - dist / Math.max(x.length, y.length);
}

/**
 * Find the existing players whose name (or any of their aliases) most resembles
 * `name`. Used both for the live "is this a new player?" prompt and the
 * retroactive duplicate scanner.
 *
 * @param {string} name                  The unknown / candidate name.
 * @param {Array<{id:number,name:string,aliases?:string[]}>} players
 * @param {object} [opts]
 * @param {number} [opts.limit=4]         Max candidates returned.
 * @param {number} [opts.floor=0.45]      Minimum similarity to include.
 * @returns {Array<{player:object, score:number, matched:string}>}  Sorted best-first.
 */
function findCandidates(name, players, opts = {}) {
    const limit = opts.limit ?? 4;
    const floor = opts.floor ?? 0.45;
    const scored = [];

    for (const p of players) {
        const names = [p.name, ...(p.aliases || [])];
        let best = 0;
        let matched = p.name;
        for (const n of names) {
            const s = similarity(name, n);
            if (s > best) { best = s; matched = n; }
        }
        if (best >= floor) scored.push({ player: p, score: best, matched });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

/**
 * Find likely-duplicate player pairs across the whole roster.
 *
 * @param {Array<{id:number,name:string,aliases?:string[]}>} players
 * @param {number} [threshold=0.6]
 * @returns {Array<{a:object, b:object, score:number}>}  Sorted best-first, each pair once.
 */
function findDuplicatePairs(players, threshold = 0.6) {
    const pairs = [];
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i];
            const b = players[j];
            // Best score across both names + all aliases on each side.
            const aNames = [a.name, ...(a.aliases || [])];
            const bNames = [b.name, ...(b.aliases || [])];
            let best = 0;
            for (const an of aNames) {
                for (const bn of bNames) {
                    const s = similarity(an, bn);
                    if (s > best) best = s;
                }
            }
            if (best >= threshold) pairs.push({ a, b, score: best });
        }
    }
    pairs.sort((x, y) => y.score - x.score);
    return pairs;
}

module.exports = {
    stripDecorations,
    normalizeName,
    compactName,
    levenshtein,
    similarity,
    findCandidates,
    findDuplicatePairs,
};
