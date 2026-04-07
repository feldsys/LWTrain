const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { setConfig, getAllConfig, getConfig } = require('../database/queries');
const { reschedule } = require('../lottery/scheduler');
const defaults = require('../../config/default');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('train-config')
        .setDescription('Configure the lottery bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('set-admin-channel')
                .setDescription('Set the admin channel for ranking input')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('The admin channel').setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub =>
            sub.setName('set-announcement-channel')
                .setDescription('Set the announcement channel for draw results')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('The announcement channel').setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub =>
            sub.setName('set-draw-time')
                .setDescription('Set the daily draw time')
                .addStringOption(opt =>
                    opt.setName('time').setDescription('Time in HH:MM format (24h)').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('timezone').setDescription('IANA timezone (e.g., Europe/Berlin)').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-pool-size')
                .setDescription('Set train and VIP pool sizes')
                .addIntegerOption(opt =>
                    opt.setName('train').setDescription('Top N for train (default: 20)').setRequired(true).setMinValue(3).setMaxValue(50))
                .addIntegerOption(opt =>
                    opt.setName('vip').setDescription('Top N for VIP (default: 20)').setRequired(true).setMinValue(3).setMaxValue(50)))
        .addSubcommand(sub =>
            sub.setName('set-pity')
                .setDescription('Configure train pity system parameters')
                .addNumberOption(opt =>
                    opt.setName('coefficient').setDescription('Train pity coefficient (default: 0.05)').setRequired(false))
                .addIntegerOption(opt =>
                    opt.setName('exponent').setDescription('Train pity exponent (default: 2)').setRequired(false))
                .addIntegerOption(opt =>
                    opt.setName('hard-pity').setDescription('Train hard pity threshold (default: 25)').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-vip-pity')
                .setDescription('Configure VIP pity system parameters')
                .addNumberOption(opt =>
                    opt.setName('coefficient').setDescription('VIP pity coefficient (default: 0.03)').setRequired(false))
                .addIntegerOption(opt =>
                    opt.setName('exponent').setDescription('VIP pity exponent (default: 2)').setRequired(false))
                .addIntegerOption(opt =>
                    opt.setName('hard-pity').setDescription('VIP hard pity threshold (default: 30)').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('set-cooldown')
                .setDescription('Configure cooldown days')
                .addIntegerOption(opt =>
                    opt.setName('train').setDescription('Train cooldown days (default: 7)').setRequired(false).setMinValue(0).setMaxValue(30))
                .addIntegerOption(opt =>
                    opt.setName('vip').setDescription('VIP cooldown days (default: 7)').setRequired(false).setMinValue(0).setMaxValue(30)))
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('Show current configuration')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        switch (sub) {
            case 'set-admin-channel': {
                const channel = interaction.options.getChannel('channel');
                setConfig('adminChannelId', channel.id);
                await interaction.reply(`Admin channel set to ${channel}.`);
                break;
            }
            case 'set-announcement-channel': {
                const channel = interaction.options.getChannel('channel');
                setConfig('announcementChannelId', channel.id);
                await interaction.reply(`Announcement channel set to ${channel}.`);
                break;
            }
            case 'set-draw-time': {
                const time = interaction.options.getString('time');
                if (!/^\d{2}:\d{2}$/.test(time)) {
                    return interaction.reply({ content: 'Invalid time format. Use HH:MM (e.g., 20:00).', ephemeral: true });
                }
                setConfig('drawTime', time);
                const tz = interaction.options.getString('timezone');
                if (tz) setConfig('timezone', tz);
                reschedule();
                await interaction.reply(`Draw time set to **${time}** ${tz || getConfig('timezone') || defaults.timezone}.`);
                break;
            }
            case 'set-pool-size': {
                const train = interaction.options.getInteger('train');
                const vip = interaction.options.getInteger('vip');
                setConfig('trainPoolSize', train);
                setConfig('vipPoolSize', vip);
                await interaction.reply(`Pool sizes set: Train top **${train}**, VIP top **${vip}**.`);
                break;
            }
            case 'set-pity': {
                const coeff = interaction.options.getNumber('coefficient');
                const exp = interaction.options.getInteger('exponent');
                const hard = interaction.options.getInteger('hard-pity');
                if (coeff !== null) setConfig('pityCoefficient', coeff);
                if (exp !== null) setConfig('pityExponent', exp);
                if (hard !== null) setConfig('hardPityThreshold', hard);
                await interaction.reply(`Train pity updated: coefficient=${coeff ?? 'unchanged'}, exponent=${exp ?? 'unchanged'}, hard pity=${hard ?? 'unchanged'}.`);
                break;
            }
            case 'set-vip-pity': {
                const coeff = interaction.options.getNumber('coefficient');
                const exp = interaction.options.getInteger('exponent');
                const hard = interaction.options.getInteger('hard-pity');
                if (coeff !== null) setConfig('vipPityCoefficient', coeff);
                if (exp !== null) setConfig('vipPityExponent', exp);
                if (hard !== null) setConfig('vipHardPityThreshold', hard);
                await interaction.reply(`VIP pity updated: coefficient=${coeff ?? 'unchanged'}, exponent=${exp ?? 'unchanged'}, hard pity=${hard ?? 'unchanged'}.`);
                break;
            }
            case 'set-cooldown': {
                const train = interaction.options.getInteger('train');
                const vip = interaction.options.getInteger('vip');
                if (train !== null) setConfig('trainCooldownDays', train);
                if (vip !== null) setConfig('vipCooldownDays', vip);
                await interaction.reply(`Cooldown updated: train=${train ?? 'unchanged'}, vip=${vip ?? 'unchanged'}.`);
                break;
            }
            case 'show': {
                const allConfig = getAllConfig();
                const configMap = {};
                for (const { key, value } of allConfig) configMap[key] = value;

                const embed = new EmbedBuilder()
                    .setTitle('Bot Configuration')
                    .setColor(0x0099ff)
                    .addFields(
                        { name: 'Admin Channel', value: configMap.adminChannelId ? `<#${configMap.adminChannelId}>` : '_Not set_', inline: true },
                        { name: 'Announcement Channel', value: configMap.announcementChannelId ? `<#${configMap.announcementChannelId}>` : '_Not set_', inline: true },
                        { name: 'Draw Time', value: `${configMap.drawTime || defaults.drawTime} ${configMap.timezone || defaults.timezone}`, inline: true },
                        { name: 'Train Pool', value: `Top ${configMap.trainPoolSize || defaults.trainPoolSize}`, inline: true },
                        { name: 'VIP Pool', value: `Top ${configMap.vipPoolSize || defaults.vipPoolSize}`, inline: true },
                        { name: '\u200b', value: '\u200b', inline: true },
                        { name: 'Train Cooldown', value: `${configMap.trainCooldownDays || defaults.trainCooldownDays} days`, inline: true },
                        { name: 'VIP Cooldown', value: `${configMap.vipCooldownDays || defaults.vipCooldownDays} days`, inline: true },
                        { name: '\u200b', value: '\u200b', inline: true },
                        { name: 'Train Pity', value: `coeff: ${configMap.pityCoefficient || defaults.pityCoefficient}\nexp: ${configMap.pityExponent || defaults.pityExponent}\nhard: ${configMap.hardPityThreshold || defaults.hardPityThreshold}`, inline: true },
                        { name: 'VIP Pity', value: `coeff: ${configMap.vipPityCoefficient || defaults.vipPityCoefficient}\nexp: ${configMap.vipPityExponent || defaults.vipPityExponent}\nhard: ${configMap.vipHardPityThreshold || defaults.vipHardPityThreshold}`, inline: true },
                        { name: '\u200b', value: '\u200b', inline: true },
                    );

                await interaction.reply({ embeds: [embed] });
                break;
            }
        }
    },
};
