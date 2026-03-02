const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes
} = require('discord.js');
require('dotenv').config();
const fs = require('fs');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

// ─── LOAD COMMAND FILES ─────────────────────
const commands = [];
const commandFiles = fs
  .readdirSync('./commands')
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

// ─── READY EVENT ────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    // Setup database tables
    const setupDatabase = require('./database/setup');
    await setupDatabase();

    // Init giveaway manager (schedules ending giveaways, etc.)
    const { initGiveawaySystem } = require('./utils/giveawayManager');
    await initGiveawaySystem(client);

  } catch (err) {
    console.error('❌ Error during ready setup:', err);
  }

  // Register global slash commands (only from shard 0)
  const shardId = client.shard?.ids[0] ?? 0;
  if (shardId === 0) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log('✅ Slash commands registered');
    } catch (err) {
      console.error('❌ Failed to register slash commands:', err);
    }
  }

  // Status / activity
  require('./status')(client);
});

// ─── COUNTING SYSTEM ────────────────────────
const countingHandler = require('./events/countingMessage');
client.on('messageCreate', async message => {
  try {
    await countingHandler(message);
  } catch (err) {
    console.error('❌ Counting handler error:', err);
  }
});

// ─── INTERACTIONS ──────────────────────────
const interactionHandler = require('./events/interactionCreate');
client.on('interactionCreate', async interaction => {
  try {
    await interactionHandler(interaction, client);
  } catch (err) {
    console.error('❌ Interaction handler error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

// ─── GLOBAL ERROR HANDLING ─────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('❌ Uncaught Exception Monitor:', err, origin);
});

// ─── LOGIN ─────────────────────────────────
client.login(token);
