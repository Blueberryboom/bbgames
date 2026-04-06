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
const { buildMemberEventPayload, EVENT_TYPES } = require('./utils/memberEventMessages');
const { LOG_EVENT_KEYS, logGuildEvent } = require('./utils/guildLogger');
const { initializeAutoMessageScheduler, clearGuildAutoMessages } = require('./utils/autoMessageManager');
const { initializeVariableSlowmodeManager, trackMessage: trackVariableSlowmodeMessage } = require('./utils/variableSlowmodeManager');
const { initBirthdayScheduler, cleanupUserGuildData } = require('./utils/birthdaySystem');
const { queueOneWordStoryMessage, clearGuildOneWordStoryState, updateContributionStarCount } = require('./utils/oneWordStoryManager');
const { processStarboardReaction, cleanupStarboardSourceMessage } = require('./utils/starboardManager');
const { initServerTagRewardManager } = require('./utils/serverTagRewardManager');

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
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

    // Auto message scheduler.
    await initializeAutoMessageScheduler(client);

    // Variable slowmode scheduler.
    await initializeVariableSlowmodeManager(client);

    // Birthday scheduler.
    initBirthdayScheduler(client);

    // Server-tag rewards scheduler.
    initServerTagRewardManager(client);

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
const levelingHandler = require('./events/levelingMessage');
const { handleStickyMessage } = require('./utils/stickyManager');
const { clearAfkForMessage, notifyMentionedAfkUsers, formatDuration } = require('./utils/afkManager');
const { trackAchievementEvent } = require('./utils/achievementManager');
const { relayTicketMessageToTranscript } = require('./utils/ticketTranscriptRelay');
const { maybeSendTicketClaimNotice } = require('./utils/ticketClaimNotice');
const AFK_WELCOME_BACK_DELETE_MS = 6000;

client.on('messageCreate', async message => {
  try {
    const clearedAfk = await clearAfkForMessage(message);
    if (clearedAfk) {
      if (clearedAfk.durationMs >= 60 * 60 * 1000) {
        await trackAchievementEvent({
          userId: message.author.id,
          event: 'afk_1h',
          context: {
            guildId: message.guildId,
            channelId: message.channel.id,
            channel: message.channel,
            userMention: `${message.author}`
          }
        });
      }

      if (clearedAfk.durationMs >= 48 * 60 * 60 * 1000) {
        await trackAchievementEvent({
          userId: message.author.id,
          event: 'afk_48h',
          context: {
            guildId: message.guildId,
            channelId: message.channel.id,
            channel: message.channel,
            userMention: `${message.author}`
          }
        });
      }

      const placeText = clearedAfk.place ? `#${clearedAfk.place}` : 'unranked';
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`Welcome back ${message.author} 🎉`)
        .setDescription(
          `You were gone for **${formatDuration(clearedAfk.durationMs)}** and are currently **${placeText}** on the AFK leaderboard.`
        );

      const welcomeBackMessage = await message.channel.send({
        embeds: [embed]
      }).catch(() => null);

      if (welcomeBackMessage) {
        setTimeout(() => {
          welcomeBackMessage.delete().catch(() => null);
        }, AFK_WELCOME_BACK_DELETE_MS);
      }
    }

    await notifyMentionedAfkUsers(message);
    await maybeSendTicketClaimNotice(message);
    await countingHandler(message);
    await levelingHandler(message);
    await handleStickyMessage(message);
    await relayTicketMessageToTranscript(message);
    trackVariableSlowmodeMessage(message);
    await queueOneWordStoryMessage(message);
  } catch (err) {
    console.error('❌ Message handler error:', err);
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

    if (guild.ownerId && targetUser.id === guild.ownerId) {
      await trackAchievementEvent({
        userId: targetUser.id,
        event: 'bot_added_owner_server',
        context: {
          guildId: guild.id
        }
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Thanks for adding BBGames!')
      .setDescription('We really appreciate you adding the bot to your server! If you have any feeback or want to report a bug, use **/support**!')
      .addFields(
        { name: 'Main commands', value: '`/count channel` to start counting\n`/giveaway create` to run giveaways\n`/youtube add` for upload alerts\n`/log channel` to logs changes to bot settings and stuff ' },
        { name: 'Useful Commands', value: '`/help`, `/about`, `/status`, `/minecraft`, `/donate`' }
      );

    await targetUser.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('❌ guildCreate handler error:', err);
  }
});

client.on('guildDelete', async guild => {
  try {
    clearGuildAutoMessages(client, guild.id);
    clearGuildOneWordStoryState(guild.id);
    await scheduleGuildDataDeletion(guild.id, 'main_left');
    console.log(`🕒 Scheduled guild data cleanup for ${guild.id} in 3 days`);
  } catch (err) {
    console.error('❌ guildDelete cleanup error:', err);
  }
});

client.on('guildMemberAdd', async member => {
  try {
    const rows = await query(
      `SELECT channel_id, message_template, button_label, button_url
       FROM member_event_messages
       WHERE guild_id = ?
         AND event_type = ?
         AND enabled = 1
       LIMIT 1`,
      [member.guild.id, EVENT_TYPES.welcome]
    );

    if (rows.length) {
      const config = rows[0];
      const targetChannel = await member.guild.channels.fetch(config.channel_id).catch(() => null);
      if (targetChannel?.isTextBased()) {
        const payload = buildMemberEventPayload(EVENT_TYPES.welcome, member, member.guild, config);
        await targetChannel.send(payload);
      }
    }

    await logGuildEvent(
      member.client,
      member.guild.id,
      LOG_EVENT_KEYS.joins,
      `📥 **Member joined:** <@${member.id}> (${member.user.tag})`
    );
  } catch (err) {
    console.error('❌ Welcome system error:', err);
  }
});

client.on('guildMemberRemove', async member => {
  try {
    const rows = await query(
      `SELECT channel_id, message_template, button_label, button_url
       FROM member_event_messages
       WHERE guild_id = ?
         AND event_type = ?
         AND enabled = 1
       LIMIT 1`,
      [member.guild.id, EVENT_TYPES.leave]
    );

    if (rows.length) {
      const config = rows[0];
      const targetChannel = await member.guild.channels.fetch(config.channel_id).catch(() => null);
      if (targetChannel?.isTextBased()) {
        const payload = buildMemberEventPayload(EVENT_TYPES.leave, member.user || member, member.guild, config);
        await targetChannel.send(payload);
      }
    }

    await logGuildEvent(
      member.client,
      member.guild.id,
      LOG_EVENT_KEYS.leaves,
      `📤 **Member left:** <@${member.id}> (${member.user?.tag || member.id})`
    );

    await cleanupUserGuildData(member.guild.id, member.id);
  } catch (err) {
    console.error('❌ guildMemberRemove cleanup error:', err);
  }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const startedBoosting = !oldMember.premiumSinceTimestamp && !!newMember.premiumSinceTimestamp;
    if (!startedBoosting) return;

    const rows = await query(
      `SELECT channel_id, message_template, button_label, button_url
       FROM member_event_messages
       WHERE guild_id = ?
         AND event_type = ?
         AND enabled = 1
       LIMIT 1`,
      [newMember.guild.id, EVENT_TYPES.boost]
    );

    if (rows.length) {
      const config = rows[0];
      const targetChannel = await newMember.guild.channels.fetch(config.channel_id).catch(() => null);
      if (targetChannel?.isTextBased()) {
        const payload = buildMemberEventPayload(EVENT_TYPES.boost, newMember, newMember.guild, config);
        await targetChannel.send(payload);
      }
    }

    await logGuildEvent(
      newMember.client,
      newMember.guild.id,
      LOG_EVENT_KEYS.boosts,
      `🚀 **Server boost:** <@${newMember.id}> started boosting the server.`
    );
  } catch (err) {
    console.error('❌ boost message system error:', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user?.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message?.guildId) return;

    if (reaction.emoji?.name === '✅') {
      await updateContributionStarCount({
        guildId: reaction.message.guildId,
        channelId: reaction.message.channelId,
        messageId: reaction.message.id,
        delta: 1
      });
    }

    await processStarboardReaction(reaction, user);
  } catch (err) {
    console.error('❌ messageReactionAdd handler error:', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    if (user?.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message?.guildId) return;

    if (reaction.emoji?.name === '✅') {
      await updateContributionStarCount({
        guildId: reaction.message.guildId,
        channelId: reaction.message.channelId,
        messageId: reaction.message.id,
        delta: -1
      });
    }

    await processStarboardReaction(reaction, user);
  } catch (err) {
    console.error('❌ messageReactionRemove handler error:', err);
  }
});

client.on('messageDelete', async message => {
  try {
    if (!message?.guildId || !message?.id) return;
    await cleanupStarboardSourceMessage(message.guildId, message.id);
  } catch (err) {
    console.error('❌ messageDelete cleanup error:', err);
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
