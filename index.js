const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  MessageFlags,
  EmbedBuilder,
  AuditLogEvent
} = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const premiumManager = require('./utils/premiumManager');
const { startGuildCleanupScheduler, scheduleGuildDataDeletion, cancelGuildDataDeletion } = require('./utils/guildCleanup');
const { initPremiumAccessManager } = require('./utils/premiumAccessManager');
const { query } = require('./database');
const { buildWelcomePayload } = require('./utils/welcomeSystem');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('❌ TOKEN or CLIENT_ID missing in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();
client.premiumManager = premiumManager;


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
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    // Setup database
    const setupDatabase = require('./database/setup');
    await setupDatabase();
    console.log('✅ Database setup complete!');

    // Init giveaway manager
    const { initGiveawaySystem } = require('./utils/giveawayManager');
    await initGiveawaySystem(client);
    console.log('✅ Giveaway system initialised');

    // Init YouTube notifier
    const { initYouTubeNotifier } = require('./utils/youtubeNotifier');
    initYouTubeNotifier(client);

    // Restore premium bot instances (shard 0 only)
    await premiumManager.restorePremiumInstances(client);

    // Premium access via subscription roles + expiry checks.
    initPremiumAccessManager(client);

    // Delayed guild data cleanup worker (shard 0 only).
    startGuildCleanupScheduler(client);

  } catch (err) {
    console.error('❌ Error during ready setup:', err);
  }

  // Register slash commands (only shard 0)
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

  // Status system
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




// ─── GUILD JOIN/LEAVE AUTOMATION ───────────
client.on('guildCreate', async guild => {
  try {
    await cancelGuildDataDeletion(guild.id);

    let premiumGuildConflict = premiumManager.hasPremiumInGuild(guild.id);

    if (!premiumGuildConflict && client.shard) {
      const results = await client.shard.broadcastEval(
        (shardClient, context) => shardClient.premiumManager?.hasPremiumInGuild(context.guildId) || false,
        { context: { guildId: guild.id } }
      );
      premiumGuildConflict = results.some(Boolean);
    }

    if (premiumGuildConflict) {
      await guild.leave().catch(() => null);
      return;
    }
    let targetUser = guild.ownerId ? await client.users.fetch(guild.ownerId).catch(() => null) : null;

    try {
      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (me?.permissions.has('ViewAuditLog')) {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 }).catch(() => null);
        const entry = logs?.entries?.find(e => e.target?.id === client.user.id);
        if (entry?.executor?.id) {
          targetUser = await client.users.fetch(entry.executor.id).catch(() => targetUser);
        }
      }
    } catch {}

    if (!targetUser) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Thanks for adding BBGames!')
      .setDescription('Quick start: use `/config panel` first, then set your admin role with `/config admin_role`.')
      .addFields(
        { name: 'Recommended Setup', value: '`/count channel` to start counting\n`/giveaway create` to run giveaways\n`/youtube add` for upload alerts' },
        { name: 'Useful Commands', value: '`/help`, `/about`, `/status`, `/minecraft`, `/donate`' }
      );

    await targetUser.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('❌ guildCreate handler error:', err);
  }
});

client.on('guildDelete', async guild => {
  try {
    await scheduleGuildDataDeletion(guild.id, 'main_left');
    console.log(`🕒 Scheduled guild data cleanup for ${guild.id} in 3 days`);
  } catch (err) {
    console.error('❌ guildDelete cleanup error:', err);
  }
});

client.on('guildMemberAdd', async member => {
  try {
    const rows = await query(
      `SELECT channel_id, message_key, button_label, button_url
       FROM welcome_settings
       WHERE guild_id = ?
       LIMIT 1`,
      [member.guild.id]
    );

    if (!rows.length) return;

    const config = rows[0];
    const targetChannel = await member.guild.channels.fetch(config.channel_id).catch(() => null);
    if (!targetChannel?.isTextBased()) return;

    const payload = buildWelcomePayload(member, member.guild, config);
    await targetChannel.send(payload);
  } catch (err) {
    console.error('❌ Welcome system error:', err);
  }
});

// ─── INTERACTIONS ──────────────────────────
const interactionHandler = require('./events/interactionCreate');

client.on('interactionCreate', async interaction => {
  try {
    await interactionHandler(interaction);
  } catch (err) {
    console.error('❌ Interaction handler error:', err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});


// ─── GLOBAL ERROR HANDLING ─────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('❌ Uncaught Exception Monitor:', err, origin);
});


// ─── LOGIN ─────────────────────────────────
client.login(token);
