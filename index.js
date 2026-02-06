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
    GatewayIntentBits.GuildMembers
  ]
});

client.commands = new Collection();

// ✅ Load button handler ONCE
const giveawayButtonHandler =
  require('./events/giveawayButtons');


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


// ─── READY EVENT (SHARD AWARE) ──────────────

client.on('clientReady', async () => {

  const shardId = client.shard?.ids[0] ?? 0;

  console.log(
    `Logged in as ${client.user.tag} | Shard ${shardId}`
  );

  // ─── DATABASE SETUP ───────────────────────
  try {
    const setupDatabase = require('./database/setup');
    await setupDatabase();
  } catch (err) {
    console.error("❌ Database setup failed:", err);
  }

  // ─── REGISTER COMMANDS (ONLY ON SHARD 0) ──
  if (shardId === 0) {

    const rest = new REST({ version: '10' }).setToken(token);

    try {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );

      console.log('✅ Slash commands registered!');

    } catch (err) {
      console.error("❌ Command registration failed:", err);
    }
  }

  // ─── LOAD SYSTEMS ─────────────────────────

  require('./status')(client);

  try {
    require('./tasks/giveawayEnder')(client);
  } catch (err) {
    console.error("❌ Giveaway task failed to load:", err);
  }

});


// ─── INTERACTION HANDLER ────────────────────

client.on('interactionCreate', async interaction => {

  // ─── BUTTON HANDLER ───────────────────────
  if (interaction.isButton()) {
    try {
      await giveawayButtonHandler(interaction);
    } catch (err) {
      console.error("Button handler error:", err);
    }
    return;
  }

  // ─── SLASH COMMANDS ───────────────────────
  if (!interaction.isChatInputCommand()) return;

  const command =
    client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);

  } catch (error) {
    console.error(error);

    const errorMsg =
      '❌ There was an error running this command.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: errorMsg,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: errorMsg,
        ephemeral: true
      });
    }
  }

});


// ─── LOGIN ─────────────────

process.on('unhandledRejection', err => {
  console.error("🔥 UNHANDLED REJECTION:", err);
});

process.on('uncaughtException', err => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

client.login(token);
