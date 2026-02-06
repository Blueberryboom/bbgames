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

client.on('ready', async () => {

  const shardId = client.shard?.ids[0] ?? 0;

  console.log(
    `Logged in as ${client.user.tag} | Shard ${shardId}`
  );

  // 👉 ONLY REGISTER COMMANDS ON SHARD 0
  if (shardId === 0) {

    const rest = new REST({ version: '10' }).setToken(token);

    try {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );

      console.log('Slash commands registered!');

    } catch (err) {
      console.error(err);
    }
  }

  // Load dynamic status system
  require('./status')(client);
});


// ─── INTERACTION HANDLER ────────────────────

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  const command =
    client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);

  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ There was an error running this command.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ There was an error running this command.',
        ephemeral: true
      });
    }
  }
});


// ─── LOGIN ──────────────────────────────────

client.login(token);
