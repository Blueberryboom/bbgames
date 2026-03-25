const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  MessageFlags
} = require('discord.js');
const fs = require('fs');
const { query } = require('../database');
const { buildWelcomePayload } = require('./welcomeSystem');
const { scheduleGuildDataDeletion, cancelGuildDataDeletion } = require('./guildCleanup');
const { handleStickyMessage } = require('./stickyManager');
const { stopYouTubeNotifier } = require('./youtubeNotifier');
const { stopStatus } = require('../status');

const activeInstances = new Map(); // ownerId -> instance
const guildOwners = new Map(); // guildId -> ownerId
let mainClientRef = null;

const MAX_PREMIUM_GUILDS_PER_BOT = 1;

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
      await countingHandler(message);
      await handleStickyMessage(message);
    } catch (err) {
      console.error('❌ Premium counting handler error:', err);
    }
  });

  premiumClient.on('guildMemberAdd', async member => {
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
          content: '❌ Something went wrong.',
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

      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(
        Routes.applicationCommands(premiumClient.user.id),
        { body: commands }
      );

      console.log(`✅ Premium runtime ready for ${premiumClient.user.tag}`);
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

async function savePremiumInstance(ownerId, token, enabled) {
  await query(
    `REPLACE INTO premium_instances
     (owner_id, token, enabled, updated_at)
     VALUES (?, ?, ?, ?)`,
    [ownerId, token, enabled ? 1 : 0, Date.now()]
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

async function startPremiumInstance(mainClient, ownerId, token, options = {}) {
  const { persist = true } = options;
  mainClientRef = mainClient;

  if (activeInstances.has(ownerId)) {
    throw new Error('You already have an active premium bot instance. Stop it first.');
  }

  const premiumClient = buildPremiumClient();
  await initPremiumRuntime(premiumClient, token);
  let started = false;

  const cleanupInstance = () => {
    const instance = activeInstances.get(ownerId);
    if (!instance) return;

    for (const guildId of instance.guildIds) {
      if (guildOwners.get(guildId) === ownerId) {
        guildOwners.delete(guildId);
      }
    }

    activeInstances.delete(ownerId);
  };

  premiumClient.on('guildDelete', guild => {
    const instance = activeInstances.get(ownerId);
    if (!instance) return;

    instance.guildIds.delete(guild.id);
    if (guildOwners.get(guild.id) === ownerId) {
      guildOwners.delete(guild.id);
    }

    scheduleGuildDataDeletion(guild.id, 'premium_left').catch(() => null);
  });

  premiumClient.on('guildCreate', async guild => {
    try {
      const mainGuildIds = await getMainGuildIds(mainClient);
      const existingOwner = guildOwners.get(guild.id);
      const premiumConflict = await hasPremiumInGuildGlobal(mainClient, guild.id);

      const instance = activeInstances.get(ownerId);
      const hasGuildLimitReached = instance && instance.guildIds.size >= MAX_PREMIUM_GUILDS_PER_BOT && !instance.guildIds.has(guild.id);

      if (mainGuildIds.has(guild.id) || (existingOwner && existingOwner !== ownerId) || premiumConflict || hasGuildLimitReached) {
        await guild.leave().catch(() => null);
        return;
      }

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

    const premiumGuildIds = [...premiumClient.guilds.cache.keys()];

    if (premiumGuildIds.length > MAX_PREMIUM_GUILDS_PER_BOT) {
      const keepGuildId = premiumGuildIds[0];
      const removedGuildIds = await leaveExtraGuilds(premiumClient, new Set([keepGuildId]));
      throw new Error(`Premium bots can only be in 1 server. Left ${removedGuildIds.length} extra server(s); please keep only one and try again.`);
    }

    const mainGuildIds = await getMainGuildIds(mainClient);

    const overlapWithMain = premiumGuildIds.filter(guildId => mainGuildIds.has(guildId));
    if (overlapWithMain.length) {
      await premiumClient.destroy();
      throw new Error('This premium bot is already in one or more servers where the normal bot exists. Remove one of them first.');
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
      guildOwners.set(guildId, ownerId);
      await cancelGuildDataDeletion(guildId);
    }

    activeInstances.set(ownerId, {
      ownerId,
      botUserId: premiumClient.user.id,
      botTag: premiumClient.user.tag,
      client: premiumClient,
      startedAt: Date.now(),
      guildIds: new Set(premiumGuildIds)
    });

    if (persist) {
      await savePremiumInstance(ownerId, token, true);
    }

    return {
      botTag: premiumClient.user.tag,
      botUserId: premiumClient.user.id,
      guildCount: premiumGuildIds.length
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
  const { persist = true } = options;
  const instance = activeInstances.get(ownerId);
  if (!instance) {
    if (persist) {
      await setPremiumInstanceEnabled(ownerId, false);
    }
    return false;
  }

  activeInstances.delete(ownerId);

  for (const guildId of instance.guildIds) {
    if (guildOwners.get(guildId) === ownerId) {
      guildOwners.delete(guildId);
    }

    await scheduleGuildDataDeletion(guildId, 'premium_stopped');
  }

  stopYouTubeNotifier(instance.client);
  stopStatus(instance.client);
  await instance.client.destroy();

  if (persist) {
    await setPremiumInstanceEnabled(ownerId, false);
  }

  return true;
}

async function restorePremiumInstances(mainClient) {
  mainClientRef = mainClient;

  const shardId = mainClient.shard?.ids?.[0] ?? 0;
  if (mainClient.shard && shardId !== 0) {
    return;
  }

  const rows = await query(
    `SELECT owner_id, token
     FROM premium_instances
     WHERE enabled = 1`
  );

  for (const row of rows) {
    try {
      await startPremiumInstance(mainClient, row.owner_id, row.token, { persist: false });
      console.log(`✅ Restored premium instance for user ${row.owner_id}`);
    } catch (error) {
      console.error(`❌ Failed to restore premium instance for user ${row.owner_id}:`, error.message);
      await setPremiumInstanceEnabled(row.owner_id, false);
    }
  }
}

function getInstanceStatus(ownerId) {
  const instance = activeInstances.get(ownerId);
  if (!instance) return null;

  return {
    ownerId,
    botTag: instance.botTag,
    botUserId: instance.botUserId,
    guildCount: instance.guildIds.size,
    startedAt: instance.startedAt
  };
}

function hasPremiumInGuild(guildId) {
  return guildOwners.has(guildId);
}

function hasInstanceForUser(ownerId) {
  return activeInstances.has(ownerId);
}


function getPremiumGuildsSnapshot() {
  const guilds = [];

  for (const [ownerId, instance] of activeInstances.entries()) {
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
