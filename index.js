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

// ✅ Load systems ONCE
const giveawayButtonHandler = require('./events/giveawayButtons');
const countingHandler = require('./events/countingMessage');
const countingDeleteHandler = require('./events/countingDelete');   // ← ADDED

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

// ─── MESSAGE HANDLER (COUNTING) ─────────────
client.on('messageCreate', async message => {
  try {
    await countingHandler(message);
  } catch (err) {
    console.error("Counting error:", err);
  }
});

// ─── MESSAGE DELETE (COUNTING PROTECTION) ───
client.on('messageDelete', async message => {
  try {
    await countingDeleteHandler(message);
  } catch (err) {
    console.error("Counting delete handler error:", err);
  }
});

// ─── INTERACTION HANDLER ────────────────────
client.on('interactionCreate', async interaction => {

  // ─── GLOBAL PERMISSION GUARD ─────────────
  if (interaction.inGuild()) {

    const me = interaction.guild.members.me;

    const needed = [
      "SendMessages",
      "EmbedLinks",
      "ViewChannel",
      "ManageMessages"
    ];

    const missing = needed.filter(
      p => !me.permissions.has(p)
    );

    if (missing.length > 0) {
      return interaction.reply({
        content:
          "⚠️ Bot missing permissions:\n" +
          missing.join(", "),
        ephemeral: true
      });
    }
  }

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

// ─── SAFETY NET ─────────────────────────────
process.on('unhandledRejection', err => {
  console.error("🔥 UNHANDLED REJECTION:", err);
});

process.on('uncaughtException', err => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

// ─── LOGIN ──────────────────────────────────
client.login(token);
