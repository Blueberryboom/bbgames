const { Client, GatewayIntentBits } = require('discord.js');
const { query } = require('../database');

const activeInstances = new Map(); // ownerId -> instance
const guildOwners = new Map(); // guildId -> ownerId

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
    'SELECT 1 FROM premium_allowed_users WHERE user_id = ? LIMIT 1',
    [userId]
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

  if (activeInstances.has(ownerId)) {
    throw new Error('You already have an active premium bot instance. Stop it first.');
  }

  const premiumClient = buildPremiumClient();
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
  });

  premiumClient.on('guildCreate', async guild => {
    try {
      const mainGuildIds = await getMainGuildIds(mainClient);
      const existingOwner = guildOwners.get(guild.id);
      const premiumConflict = await hasPremiumInGuildGlobal(mainClient, guild.id);

      if (mainGuildIds.has(guild.id) || (existingOwner && existingOwner !== ownerId) || premiumConflict) {
        await guild.leave().catch(() => null);
        return;
      }

      guildOwners.set(guild.id, ownerId);
      const instance = activeInstances.get(ownerId);
      instance?.guildIds.add(guild.id);
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
  }

  await instance.client.destroy();

  if (persist) {
    await setPremiumInstanceEnabled(ownerId, false);
  }

  return true;
}

async function restorePremiumInstances(mainClient) {
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

module.exports = {
  startPremiumInstance,
  stopPremiumInstance,
  restorePremiumInstances,
  isPremiumAllowedUser,
  hasInstanceForUserGlobal,
  getInstanceStatus,
  hasPremiumInGuild,
  hasInstanceForUser
};
