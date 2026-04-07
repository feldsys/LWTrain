module.exports = {
    // Channel IDs (set via /config or .env)
    adminChannelId: process.env.ADMIN_CHANNEL_ID || null,
    announcementChannelId: process.env.ANNOUNCEMENT_CHANNEL_ID || null,

    // Draw schedule
    drawTime: '20:00',
    timezone: 'Europe/Berlin',
    countdownMinutes: 5,

    // Pool sizes
    trainPoolSize: 20,
    vipPoolSize: 20,

    // Cooldown
    trainCooldownDays: 7,
    vipCooldownDays: 7,

    // Train pity system
    pityCoefficient: 0.05,
    pityExponent: 2,
    hardPityThreshold: 25,

    // VIP pity system (slower buildup, hard pity at 30)
    vipPityCoefficient: 0.03,
    vipPityExponent: 2,
    vipHardPityThreshold: 30,

    // Display
    showProbabilities: true,
    showPityInPublic: false,

    // Parsing
    minPlayersForDraw: 3,
};
