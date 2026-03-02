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

// ─── READY ──────────────────────────────────
client.once('clientReady', async () => {

  try {
    const setupDatabase = require('./database/setup');
    await setupDatabase();

    const { initGiveawaySystem } = require('./utils/giveawayManager');
    await initGiveawaySystem(client);

  } catch {}

  const shardId = client.shard?.ids[0] ?? 0;

  if (shardId === 0) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
    } catch {}
  }

  require('./status')(client);
});

// ─── COUNTING ───────────────────────────────
const countingHandler = require('./events/countingMessage');
client.on('messageCreate', async message => {
  try {
    await countingHandler(message);
  } catch {}
});

// ─── INTERACTIONS ───────────────────────────
client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong.',
        flags: 64
      }).catch(() => {});
    }
  }
});

process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

client.login(token);
