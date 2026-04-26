const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  MessageFlags,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const { query } = require('../database');
const { buildMemberEventPayload, EVENT_TYPES } = require('./memberEventMessages');
const { scheduleGuildDataDeletion, cancelGuildDataDeletion } = require('./guildCleanup');
const { handleStickyMessage } = require('./stickyManager');
const handleLevelingMessage = require('../events/levelingMessage');
const { stopYouTubeNotifier } = require('./youtubeNotifier');
const { stopStatus } = require('../status');
const { initializeAutoMessageScheduler, clearGuildAutoMessages, stopAutoMessageSchedulers } = require('./autoMessageManager');
const { clearAfkForMessage, notifyMentionedAfkUsers, formatDuration } = require('./afkManager');
const { BOT_OWNER_ID } = require('./constants');
const { queueOneWordStoryMessage } = require('./oneWordStoryManager');

const activeInstances = new Map(); // instanceId -> instance
const ownerInstances = new Map(); // ownerId -> Set(instanceId)
const guildOwners = new Map(); // guildId -> ownerId
let mainClientRef = null;

const MAX_PREMIUM_GUILDS_PER_BOT = 1;
const AFK_WELCOME_BACK_DELETE_MS = 6000;

async function leaveExtraGuilds(client, keepGuildIds = new Set()) {
  const guilds = [...client.guilds.cache.values()];
  const extras = guilds.filter(g => !keepGuildIds.has(g.id));

  for (const guild of extras) {
    await guild.leave().catch(() => null);
  }

  return extras.map(g => g.id);
}

function loadCommandData(client) {
  client.commands = new Collection();

  const commands = [];
  const commandFiles = fs
    .readdirSync('./commands')
    .filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(`../commands/${file}`);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
  }

  return commands;
}

async function initPremiumRuntime(premiumClient, token) {
  premiumClient.isPremiumInstance = true;
  premiumClient.premiumManager = module.exports;

  const commands = loadCommandData(premiumClient);

  const countingHandler = require('../events/countingMessage');
  premiumClient.on('messageCreate', async message => {
    try {
      const clearedAfk = await clearAfkForMessage(message);
      if (clearedAfk) {
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
      await countingHandler(message);
      await handleLevelingMessage(message);
      await handleStickyMessage(message);
      await queueOneWordStoryMessage(message);
    } catch (err) {
      console.error('❌ Premium counting handler error:', err);
    }
  });

  premiumClient.on('guildMemberAdd', async member => {
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

      const bumpRows = await query('SELECT invite_code FROM bumping_configs WHERE guild_id = ? AND invite_code IS NOT NULL LIMIT 1', [member.guild.id]);
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

      if (!rows.length) return;

      const config = rows[0];
      const targetChannel = await member.guild.channels.fetch(config.channel_id).catch(() => null);
      if (!targetChannel?.isTextBased()) return;

      const payload = buildMemberEventPayload(EVENT_TYPES.welcome, member, member.guild, config);
      await targetChannel.send(payload);
    } catch (err) {
      console.error('❌ Premium welcome system error:', err);
    }
  });

  const interactionHandler = require('../events/interactionCreate');
  premiumClient.on('interactionCreate', async interaction => {
    try {
      await interactionHandler(interaction);
    } catch (err) {
      console.error('❌ Premium interaction handler error:', err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '<:warning:1496193692099285255> Something went wrong.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    }
  });

  premiumClient.once('clientReady', async () => {
    try {
      const { initGiveawaySystem } = require('./giveawayManager');
      await initGiveawaySystem(premiumClient);

      const { initYouTubeNotifier } = require('./youtubeNotifier');
      initYouTubeNotifier(premiumClient);

      require('../status')(premiumClient);

      await initializeAutoMessageScheduler(premiumClient);

      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(
        Routes.applicationCommands(premiumClient.user.id),
        { body: commands }
      );

      const guildCount = premiumClient.guilds.cache.size;
      const memberCount = premiumClient.guilds.cache.reduce((total, guild) => total + Number(guild.memberCount || 0), 0);
      console.log(`✅ Premium runtime ready for ${premiumClient.user.tag} | Servers: ${guildCount} | Members: ${memberCount}`);
    } catch (error) {
      console.error('❌ Premium runtime setup failed:', error);
    }
  });
}

function buildPremiumClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });
}

async function getMainGuildIds(mainClient) {
  if (mainClient.shard) {
    const lists = await mainClient.shard.broadcastEval(client => [...client.guilds.cache.keys()]);
    return new Set(lists.flat());
  }

  return new Set(mainClient.guilds.cache.keys());
}

async function leaveMainBotFromGuild(mainClient, guildId) {
  if (!guildId) return false;

  if (mainClient.shard) {
    const results = await mainClient.shard.broadcastEval(
      async (client, context) => {
        const guild = client.guilds.cache.get(context.guildId);
        if (!guild) return false;
        await guild.leave().catch(() => null);
        return true;
      },
      { context: { guildId } }
    );

    return results.some(Boolean);
  }

  const guild = mainClient.guilds.cache.get(guildId) || await mainClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  await guild.leave().catch(() => null);
  return true;
}

async function hasPremiumInGuildGlobal(mainClient, guildId) {
  if (!mainClient.shard) {
    return hasPremiumInGuild(guildId);
  }

  const results = await mainClient.shard.broadcastEval(
    (client, context) => client.premiumManager?.hasPremiumInGuild(context.guildId) || false,
    { context: { guildId } }
  );

  return results.some(Boolean);
}

async function hasInstanceForUserGlobal(mainClient, ownerId) {
  if (!mainClient.shard) {
    return hasInstanceForUser(ownerId);
  }

  const results = await mainClient.shard.broadcastEval(
    (client, context) => client.premiumManager?.hasInstanceForUser(context.ownerId) || false,
    { context: { ownerId } }
  );

  return results.some(Boolean);
}

function getMaxInstancesForUser(ownerId) {
  return ownerId === BOT_OWNER_ID ? Infinity : 1;
}

function addOwnerInstance(ownerId, instanceId) {
  if (!ownerInstances.has(ownerId)) {
    ownerInstances.set(ownerId, new Set());
  }
  ownerInstances.get(ownerId).add(instanceId);
}

function removeOwnerInstance(ownerId, instanceId) {
  const instances = ownerInstances.get(ownerId);
  if (!instances) return;
  instances.delete(instanceId);
  if (!instances.size) {
    ownerInstances.delete(ownerId);
  }
}

function getOtherPremiumOverlapGuilds(ownerId, guildIds) {
  const overlaps = [];

  for (const guildId of guildIds) {
    const existingOwner = guildOwners.get(guildId);
    if (existingOwner && existingOwner !== ownerId) {
      overlaps.push(guildId);
    }
  }

  return overlaps;
}

async function isPremiumAllowedUser(userId) {
  const rows = await query(
    `SELECT 1
     FROM premium_allowed_users
     WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
    [userId, Date.now()]
  );

  return rows.length > 0;
}

async function savePremiumInstance(instanceId, ownerId, token, enabled, customStatuses = [], botUserId = null) {
  const [statusOne, statusTwo] = customStatuses;
  await query(
    `REPLACE INTO premium_instances
     (instance_id, owner_id, bot_user_id, token, enabled, status_one, status_two, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [instanceId, ownerId, botUserId, token, enabled ? 1 : 0, statusOne || null, statusTwo || null, Date.now()]
  );
}

async function setPremiumInstanceEnabled(ownerId, enabled) {
  await query(
    `UPDATE premium_instances
     SET enabled = ?, updated_at = ?
     WHERE owner_id = ?`,
    [enabled ? 1 : 0, Date.now(), ownerId]
  );
}

async function setPremiumInstanceEnabledById(ownerId, instanceId, enabled) {
  await query(
    `UPDATE premium_instances
     SET enabled = ?, updated_at = ?
     WHERE owner_id = ? AND instance_id = ?`,
    [enabled ? 1 : 0, Date.now(), ownerId, instanceId]
  );
}

async function startPremiumInstance(mainClient, ownerId, token, options = {}) {
  const {
    persist = true,
    instanceId = `${ownerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    customStatuses = []
  } = options;
  mainClientRef = mainClient;

  const currentCount = ownerInstances.get(ownerId)?.size || 0;
  if (currentCount >= getMaxInstancesForUser(ownerId)) {
    throw new Error('You already have an active premium bot instance. Stop it first.');
  }

  const premiumClient = buildPremiumClient();
  premiumClient.customStatuses = customStatuses.filter(Boolean).slice(0, 2);
  premiumClient.customStatusIndex = 0;
  await initPremiumRuntime(premiumClient, token);
  let started = false;

  const cleanupInstance = () => {
    const instance = activeInstances.get(instanceId);
    if (!instance) return;

    for (const guildId of instance.guildIds) {
      if (guildOwners.get(guildId) === ownerId) {
        guildOwners.delete(guildId);
      }
    }

    activeInstances.delete(instanceId);
    removeOwnerInstance(ownerId, instanceId);
  };

  premiumClient.on('guildDelete', guild => {
    clearGuildAutoMessages(premiumClient, guild.id);
    const instance = activeInstances.get(instanceId);
    if (!instance) return;

    instance.guildIds.delete(guild.id);
    if (guildOwners.get(guild.id) === ownerId) {
      guildOwners.delete(guild.id);
    }

    scheduleGuildDataDeletion(guild.id, 'premium_left').catch(() => null);
  });

  premiumClient.on('guildCreate', async guild => {
    try {
      const existingOwner = guildOwners.get(guild.id);
      const premiumConflict = await hasPremiumInGuildGlobal(mainClient, guild.id);

      const instance = activeInstances.get(instanceId);
      const hasGuildLimitReached = instance
        ? (instance.guildIds.size >= MAX_PREMIUM_GUILDS_PER_BOT && !instance.guildIds.has(guild.id))
        : premiumClient.guilds.cache.size > MAX_PREMIUM_GUILDS_PER_BOT;

      if ((existingOwner && existingOwner !== ownerId) || premiumConflict || hasGuildLimitReached) {
        await guild.leave().catch(() => null);
        return;
      }

      await leaveMainBotFromGuild(mainClient, guild.id).catch(() => null);

      guildOwners.set(guild.id, ownerId);
      instance?.guildIds.add(guild.id);
      await cancelGuildDataDeletion(guild.id);
    } catch (error) {
      console.error('❌ Premium guildCreate check failed:', error);
    }
  });

  premiumClient.on('error', error => {
    console.error('❌ Premium client error:', error);
  });

  premiumClient.on('shardError', error => {
    console.error('❌ Premium shard error:', error);
  });

  try {
    await premiumClient.login(token);
    started = true;

    let premiumGuildIds = [...premiumClient.guilds.cache.keys()];

    if (premiumGuildIds.length > MAX_PREMIUM_GUILDS_PER_BOT) {
      const keepGuildId = premiumGuildIds[0];
      await leaveExtraGuilds(premiumClient, new Set([keepGuildId]));
      premiumGuildIds = [keepGuildId];
    }

    const overlapWithPremiumLocal = getOtherPremiumOverlapGuilds(ownerId, premiumGuildIds);
    const overlapWithPremiumGlobal = [];

    for (const guildId of premiumGuildIds) {
      if (await hasPremiumInGuildGlobal(mainClient, guildId)) {
        overlapWithPremiumGlobal.push(guildId);
      }
    }

    const overlapWithPremium = [...new Set([...overlapWithPremiumLocal, ...overlapWithPremiumGlobal])];
    if (overlapWithPremium.length) {
      await premiumClient.destroy();
      throw new Error('This premium bot is already in a server used by another premium instance.');
    }

    for (const guildId of premiumGuildIds) {
      await leaveMainBotFromGuild(mainClient, guildId).catch(() => null);
      guildOwners.set(guildId, ownerId);
      await cancelGuildDataDeletion(guildId);
    }

    activeInstances.set(instanceId, {
      instanceId,
      ownerId,
      botUserId: premiumClient.user.id,
      botTag: premiumClient.user.tag,
      client: premiumClient,
      startedAt: Date.now(),
      guildIds: new Set(premiumGuildIds),
      customStatuses: premiumClient.customStatuses
    });
    addOwnerInstance(ownerId, instanceId);

    if (persist) {
      await savePremiumInstance(instanceId, ownerId, token, true, premiumClient.customStatuses, premiumClient.user.id);
    }

    return {
      botTag: premiumClient.user.tag,
      botUserId: premiumClient.user.id,
      guildCount: premiumGuildIds.length,
      statusLine: premiumClient.customStatuses.length ? premiumClient.customStatuses.join(' ↔ ') : null
    };
  } catch (error) {
    if (started) {
      cleanupInstance();
      await premiumClient.destroy().catch(() => null);
    }

    throw error;
  }
}

async function stopPremiumInstance(ownerId, options = {}) {
  const { persist = true, instanceId = null } = options;
  const instanceIds = instanceId ? [instanceId] : [...(ownerInstances.get(ownerId) || [])];
  if (!instanceIds.length) {
    if (persist) {
      await setPremiumInstanceEnabled(ownerId, false);
    }
    return false;
  }

  let stoppedAny = false;

  for (const targetInstanceId of instanceIds) {
    const instance = activeInstances.get(targetInstanceId);
    if (!instance) continue;
    activeInstances.delete(targetInstanceId);
    removeOwnerInstance(ownerId, targetInstanceId);
    stoppedAny = true;

    for (const guildId of instance.guildIds) {
      if (guildOwners.get(guildId) === ownerId) {
        guildOwners.delete(guildId);
      }

      await scheduleGuildDataDeletion(guildId, 'premium_stopped');
    }

    stopYouTubeNotifier(instance.client);
    stopStatus(instance.client);
    stopAutoMessageSchedulers(instance.client);
    await instance.client.destroy();
  }

  if (persist) {
    if (instanceId) {
      await setPremiumInstanceEnabledById(ownerId, instanceId, false);
    } else {
      await setPremiumInstanceEnabled(ownerId, false);
    }
  }

  return stoppedAny;
}

async function restorePremiumInstances(mainClient) {
  mainClientRef = mainClient;

  const shardId = mainClient.shard?.ids?.[0] ?? 0;
  if (mainClient.shard && shardId !== 0) {
    return;
  }

  const rows = await query(
    `SELECT instance_id, owner_id, token, status_one, status_two
     FROM premium_instances
     WHERE enabled = 1`
  );

  for (const row of rows) {
    try {
      await startPremiumInstance(mainClient, row.owner_id, row.token, {
        persist: false,
        instanceId: row.instance_id,
        customStatuses: [row.status_one, row.status_two].filter(Boolean)
      });
      console.log(`✅ Restored premium instance for user ${row.owner_id}`);
    } catch (error) {
      console.error(`❌ Failed to restore premium instance for user ${row.owner_id}:`, error.message);
      await setPremiumInstanceEnabled(row.owner_id, false);
    }
  }
}

function getInstanceStatus(ownerId) {
  const instanceIds = [...(ownerInstances.get(ownerId) || [])];
  return instanceIds
    .map(instanceId => activeInstances.get(instanceId))
    .filter(Boolean)
    .map(instance => ({
      instanceId: instance.instanceId,
      ownerId,
      botTag: instance.botTag,
      botUserId: instance.botUserId,
      guildCount: instance.guildIds.size,
      startedAt: instance.startedAt,
      statusLine: instance.customStatuses?.length ? instance.customStatuses.join(' ↔ ') : null
    }));
}

function hasPremiumInGuild(guildId) {
  return guildOwners.has(guildId);
}

function hasInstanceForUser(ownerId) {
  return (ownerInstances.get(ownerId)?.size || 0) > 0;
}


function getPremiumGuildsSnapshot() {
  const guilds = [];

  for (const instance of activeInstances.values()) {
    const ownerId = instance.ownerId;
    for (const guild of instance.client.guilds.cache.values()) {
      guilds.push({
        name: guild.name,
        id: guild.id,
        members: guild.memberCount || 0,
        ownerId,
        premium: true
      });
    }
  }

  return guilds;
}

function getPremiumAggregateCounts() {
  const guilds = getPremiumGuildsSnapshot();
  return {
    serverCount: guilds.length,
    memberCount: guilds.reduce((acc, g) => acc + (g.members || 0), 0)
  };
}

async function getMainAggregateCounts() {
  if (!mainClientRef) {
    return { serverCount: 0, memberCount: 0 };
  }

  if (mainClientRef.shard) {
    const guildCounts = await mainClientRef.shard.fetchClientValues('guilds.cache.size');
    const memberCounts = await mainClientRef.shard.broadcastEval(client =>
      client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0)
    );

    return {
      serverCount: guildCounts.reduce((acc, count) => acc + count, 0),
      memberCount: memberCounts.reduce((acc, count) => acc + count, 0)
    };
  }

  return {
    serverCount: mainClientRef.guilds.cache.size,
    memberCount: mainClientRef.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0)
  };
}

async function getNetworkAggregateCounts() {
  const [mainStats, premiumStats] = await Promise.all([
    getMainAggregateCounts(),
    Promise.resolve(getPremiumAggregateCounts())
  ]);

  return {
    serverCount: (Number(mainStats.serverCount) || 0) + (Number(premiumStats.serverCount) || 0),
    memberCount: (Number(mainStats.memberCount) || 0) + (Number(premiumStats.memberCount) || 0)
  };
}


async function sendAnnouncementToCountingChannels(rows, messageText) {
  let sent = 0;

  for (const instance of activeInstances.values()) {
    for (const row of rows) {
      const guild = instance.client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      const channel = guild.channels.cache.get(row.channel_id);
      if (!channel || !channel.isTextBased()) continue;

      try {
        await channel.send(`📢 **Announcement:**
${messageText}`);
        sent++;
      } catch {}
    }
  }

  return sent;
}

module.exports = {
  startPremiumInstance,
  stopPremiumInstance,
  restorePremiumInstances,
  isPremiumAllowedUser,
  hasInstanceForUserGlobal,
  getInstanceStatus,
  hasPremiumInGuild,
  hasInstanceForUser,
  getPremiumGuildsSnapshot,
  getPremiumAggregateCounts,
  getNetworkAggregateCounts,
  sendAnnouncementToCountingChannels
};
