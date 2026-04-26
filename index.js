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
const { startStatsApiServer } = require('./utils/statsApiServer');
const { initSuggestionManager } = require('./utils/suggestionManager');
const { initTicketAutomationManager, trackTicketMessageActivity } = require('./utils/ticketAutomationManager');
const { initMinecraftMonitorManager } = require('./utils/minecraftMonitorManager');
const { initAutoReviveManager, trackChannelActivity: trackAutoReviveChannelActivity } = require('./utils/autoReviveManager');
const { handleAutoResponderMessage, invalidateGuild: invalidateGuildAutoResponderCache } = require('./utils/autoResponderManager');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('<:warning:1496193692099285255> TOKEN or CLIENT_ID missing in .env');
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
  console.log(`<:checkmark:1495875811792781332> Logged in as ${client.user.tag}`);

  try {
    // Setup database
    const setupDatabase = require('./database/setup');
    await setupDatabase();
    console.log('<:checkmark:1495875811792781332> Database setup complete!');

    // Init giveaway manager
    const { initGiveawaySystem } = require('./utils/giveawayManager');
    await initGiveawaySystem(client);
    console.log('<:checkmark:1495875811792781332> Giveaway system initialised');

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

    // Suggestions stale/auto-close scheduler.
    initSuggestionManager(client);

    // Ticket automation scheduler.
    initTicketAutomationManager(client);

    // Minecraft monitor scheduler.
    initMinecraftMonitorManager(client);

    // Auto revive scheduler.
    initAutoReviveManager(client);

  } catch (err) {
    console.error('<:warning:1496193692099285255> Error during ready setup:', err);
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

      console.log('<:checkmark:1495875811792781332> Slash commands registered');

    } catch (err) {
      console.error('<:warning:1496193692099285255> Failed to register slash commands:', err);
    }

    startStatsApiServer(client);
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
    await trackTicketMessageActivity(message);
    trackVariableSlowmodeMessage(message);
    await queueOneWordStoryMessage(message);
    await handleAutoResponderMessage(message);
    await trackAutoReviveChannelActivity(message);
  } catch (err) {
    console.error('<:warning:1496193692099285255> Message handler error:', err);
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

    const popularityRows = await Promise.all([
      query('SELECT COUNT(*) AS total FROM counting WHERE channel_id IS NOT NULL'),
      query('SELECT COUNT(*) AS total FROM leveling_settings WHERE enabled = 1'),
      query('SELECT COUNT(*) AS total FROM member_event_messages WHERE event_type = ? AND enabled = 1', ['welcome']),
      query('SELECT COUNT(*) AS total FROM member_event_messages WHERE event_type = ? AND enabled = 1', ['boost']),
      query('SELECT COUNT(*) AS total FROM bumping_configs WHERE enabled = 1 AND channel_id IS NOT NULL AND advertisement IS NOT NULL'),
      query('SELECT COUNT(*) AS total FROM guild_logs_settings WHERE enabled = 1'),
      query('SELECT COUNT(*) AS total FROM youtube_subscriptions'),
      query('SELECT COUNT(*) AS total FROM suggestion_settings WHERE channel_id IS NOT NULL'),
      query('SELECT COUNT(*) AS total FROM ticket_settings WHERE category_id IS NOT NULL'),
      query('SELECT COUNT(*) AS total FROM starboard_configs')
    ]);

    const popularFeatures = [
      ['Counting', Number(popularityRows[0][0]?.total || 0)],
      ['Leveling', Number(popularityRows[1][0]?.total || 0)],
      ['Welcome messages', Number(popularityRows[2][0]?.total || 0)],
      ['Boost messages', Number(popularityRows[3][0]?.total || 0)],
      ['Bumping', Number(popularityRows[4][0]?.total || 0)],
      ['Logs', Number(popularityRows[5][0]?.total || 0)],
      ['YouTube alerts', Number(popularityRows[6][0]?.total || 0)],
      ['Suggestions', Number(popularityRows[7][0]?.total || 0)],
      ['Tickets', Number(popularityRows[8][0]?.total || 0)],
      ['Starboard', Number(popularityRows[9][0]?.total || 0)]
    ].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('<a:partyblob:1495854250297790725> Thanks for adding BBGames to your server!')
      .setDescription(`BBGames is a powerful bot build to replace multiple discord bots with just a single one!
It is insanely customizable and isn't just for games, somehow it became a utility bot too!
This project began as a private custom bot for Blueberryboom's discord server, so if you could donate to support the bot's development and hosting that would help a ton! Use /donate to checkout the amazing perks that you could get :)`)
      .addFields(
        { name: 'Top 10 most popular features', value: popularFeatures.map(([name, total], idx) => `**${idx + 1}.** ${name} - ${total} servers`).join('\n') || 'No usage data yet.' },
        { name: 'Useful commands', value: '`/help`, `/donate`, `/log channel`, `/count channel`, `/leveling`, `/bumping channel`, `/ticket`, `/suggestions`' }
      );

    await targetUser.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('<:warning:1496193692099285255> guildCreate handler error:', err);
  }
});

client.on('guildDelete', async guild => {
  try {
    clearGuildAutoMessages(client, guild.id);
    clearGuildOneWordStoryState(guild.id);
    invalidateGuildAutoResponderCache(guild.id);
    await scheduleGuildDataDeletion(guild.id, 'main_left');
    console.log(`🕒 Scheduled guild data cleanup for ${guild.id} in 3 days`);
  } catch (err) {
    console.error('<:warning:1496193692099285255> guildDelete cleanup error:', err);
  }
});

client.on('guildMemberAdd', async member => {
  try {
    const autoroleRows = await query('SELECT role_id FROM autoroles WHERE guild_id = ? ORDER BY created_at ASC', [member.guild.id]);
    if (autoroleRows.length) {
      const me = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
      const myHighest = me?.roles?.highest?.position || 0;
      for (const row of autoroleRows) {
        const role = member.guild.roles.cache.get(row.role_id) || await member.guild.roles.fetch(row.role_id).catch(() => null);
        if (!role) continue;
        if (role.permissions.has('Administrator')) continue;
        if (role.position >= myHighest) continue;
        await member.roles.add(role, 'BBGames autorole').catch(() => null);
      }
    }

    const bumpRows = await query('SELECT guild_id, invite_code FROM bumping_configs WHERE guild_id = ? AND invite_code IS NOT NULL LIMIT 1', [member.guild.id]);
    const bumpConfig = bumpRows[0];
    if (bumpConfig?.invite_code) {
      const invite = await member.guild.invites.fetch(bumpConfig.invite_code).catch(async () => {
        return member.client.fetchInvite(bumpConfig.invite_code).catch(() => null);
      });
      if (invite?.code && typeof invite.uses === 'number') {
        const usageRows = await query('SELECT joined_count, last_tracked_invite_uses FROM bumping_usage WHERE guild_id = ? LIMIT 1', [member.guild.id]);
        const tracked = Number(usageRows[0]?.last_tracked_invite_uses || 0);
        const currentUses = Number(invite.uses || 0);
        const increment = Math.max(0, currentUses - tracked);
        await query(
          `INSERT INTO bumping_usage (guild_id, joined_count, last_tracked_invite_uses, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             joined_count = joined_count + VALUES(joined_count),
             last_tracked_invite_uses = GREATEST(last_tracked_invite_uses, VALUES(last_tracked_invite_uses)),
             updated_at = VALUES(updated_at)`,
          [member.guild.id, increment, currentUses, Date.now()]
        );
      }
    }

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
    console.error('<:warning:1496193692099285255> Welcome system error:', err);
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
    console.error('<:warning:1496193692099285255> guildMemberRemove cleanup error:', err);
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
    console.error('<:warning:1496193692099285255> boost message system error:', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user?.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message?.guildId) return;

    if (reaction.emoji?.name === '<:checkmark:1495875811792781332>') {
      await updateContributionStarCount({
        guildId: reaction.message.guildId,
        channelId: reaction.message.channelId,
        messageId: reaction.message.id,
        delta: 1
      });
    }

    await processStarboardReaction(reaction, user);
  } catch (err) {
    console.error('<:warning:1496193692099285255> messageReactionAdd handler error:', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    if (user?.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (!reaction.message?.guildId) return;

    if (reaction.emoji?.name === '<:checkmark:1495875811792781332>') {
      await updateContributionStarCount({
        guildId: reaction.message.guildId,
        channelId: reaction.message.channelId,
        messageId: reaction.message.id,
        delta: -1
      });
    }

    await processStarboardReaction(reaction, user);
  } catch (err) {
    console.error('<:warning:1496193692099285255> messageReactionRemove handler error:', err);
  }
});

client.on('messageDelete', async message => {
  try {
    if (!message?.guildId || !message?.id) return;
    const sentRows = await query(
      'SELECT target_guild_id, sent_at FROM bumping_sent_messages WHERE message_id = ? LIMIT 1',
      [message.id]
    );
    const sentMessage = sentRows[0];
    if (sentMessage) {
      const sentAt = Number(sentMessage.sent_at || 0);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - sentAt <= thirtyDaysMs) {
        const timeoutUntil = Date.now() + (2 * 24 * 60 * 60 * 1000);
        await query(
          `REPLACE INTO bumping_restrictions (guild_id, timeout_until, reason, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [message.guildId, timeoutUntil, 'Deleted bumping bot message in last 30 days', 'system', Date.now()]
        );
        const cfgRows = await query('SELECT channel_id FROM bumping_configs WHERE guild_id = ? LIMIT 1', [message.guildId]);
        const notifyChannel = cfgRows[0]?.channel_id ? await message.guild.channels.fetch(cfgRows[0].channel_id).catch(() => null) : null;
        if (notifyChannel?.isTextBased()) {
          await notifyChannel.send('<:warning:1496193692099285255> Do not delete bumping channel messages! This server has been blacklisted from bumping for 2 days.').catch(() => null);
        }
      }
      await query('DELETE FROM bumping_sent_messages WHERE message_id = ?', [message.id]);
    }

    await cleanupStarboardSourceMessage(message.guildId, message.id);
  } catch (err) {
    console.error('<:warning:1496193692099285255> messageDelete cleanup error:', err);
  }
});

// ─── INTERACTIONS ──────────────────────────
const interactionHandler = require('./events/interactionCreate');

client.on('interactionCreate', async interaction => {
  try {
    await interactionHandler(interaction);
  } catch (err) {
    console.error('<:warning:1496193692099285255> Interaction handler error:', err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '<:warning:1496193692099285255> Something went wrong.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});


// ─── GLOBAL ERROR HANDLING ─────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('<:warning:1496193692099285255> Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
  console.error('<:warning:1496193692099285255> Uncaught Exception:', err);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.error('<:warning:1496193692099285255> Uncaught Exception Monitor:', err, origin);
});


// ─── LOGIN ─────────────────────────────────
client.login(token);
