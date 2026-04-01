require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { closeDb } = require('./database/connection');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Load slash commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
        }
    }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

// Graceful shutdown
function shutdown() {
    console.log('[SHUTDOWN] Shutting down...');
    const schedule = require('node-schedule');
    schedule.gracefulShutdown().then(() => {
        closeDb();
        client.destroy();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Prevent crashes from unhandled errors
client.on('error', err => console.error('[CLIENT] Error:', err.message));
process.on('unhandledRejection', err => console.error('[UNHANDLED]', err.message || err));

client.login(process.env.DISCORD_TOKEN);
