const { query } = require('../database');

const PREMIUM_GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000;
let expiryInterval = null;

function parseRoleIds() {
  return (process.env.PREMIUM_ACCESS_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function getConfig() {
  return {
    sourceGuildId: process.env.PREMIUM_ACCESS_GUILD_ID,
    premiumRoleIds: parseRoleIds()
  };
}

function hasAnyPremiumRole(member, roleIds) {
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

async function grantRoleBasedPremiumAccess(userId) {
  const now = Date.now();

  await query(
    `REPLACE INTO premium_allowed_users
     (user_id, added_at, source, expires_at, notified_at)
     VALUES (?, ?, 'role', NULL, NULL)`,
    [userId, now]
  );
}

async function scheduleRoleBasedExpiry(client, userId) {
  const now = Date.now();
  const expiresAt = now + PREMIUM_GRACE_PERIOD_MS;

  const rows = await query(
    `SELECT source, expires_at
     FROM premium_allowed_users
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length || rows[0].source !== 'role') {
    return;
  }

  const existingExpiry = Number(rows[0].expires_at) || null;
  if (existingExpiry && existingExpiry > now) {
    return;
  }

  await query(
    `UPDATE premium_allowed_users
     SET expires_at = ?, notified_at = ?
     WHERE user_id = ? AND source = 'role'`,
    [expiresAt, now, userId]
  );

  const user = await client.users.fetch(userId).catch(() => null);
  if (user) {
    await user.send(`Hey <@${userId}> ! Due to the cancellation of your premium subscription, the premium bot for BBGames in your server will be removed in 2 days!`).catch(() => null);
  }
}

async function evaluateMemberPremiumAccess(client, member) {
  const { sourceGuildId, premiumRoleIds } = getConfig();
  if (!sourceGuildId || !premiumRoleIds.length) return;
  if (!member || member.guild.id !== sourceGuildId) return;
  if (member.user.bot) return;

  if (hasAnyPremiumRole(member, premiumRoleIds)) {
    await grantRoleBasedPremiumAccess(member.id);
  } else {
    await scheduleRoleBasedExpiry(client, member.id);
  }
}

async function shouldHaveRolePremium(guild, userId, premiumRoleIds) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) return false;
  return hasAnyPremiumRole(member, premiumRoleIds);
}

async function processExpiredRolePremiumAccess(client) {
  const { sourceGuildId, premiumRoleIds } = getConfig();
  if (!sourceGuildId || !premiumRoleIds.length) return;

  const guild = client.guilds.cache.get(sourceGuildId) || await client.guilds.fetch(sourceGuildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();
  const rows = await query(
    `SELECT user_id
     FROM premium_allowed_users
     WHERE source = 'role'
       AND expires_at IS NOT NULL
       AND expires_at <= ?`,
    [now]
  );

  for (const row of rows) {
    const userId = row.user_id;

    const hasRoleNow = await shouldHaveRolePremium(guild, userId, premiumRoleIds);
    if (hasRoleNow) {
      await grantRoleBasedPremiumAccess(userId);
      continue;
    }

    await query(
      `DELETE FROM premium_allowed_users
       WHERE user_id = ?
         AND source = 'role'`,
      [userId]
    );

    try {
      await client.premiumManager.stopPremiumInstance(userId, { persist: true });
      console.log(`💎 Expired premium access for ${userId} and stopped premium bot.`);
    } catch (error) {
      console.error(`❌ Failed stopping expired premium instance for ${userId}:`, error.message || error);
    }
  }
}

async function runInitialRoleSync(client) {
  const { sourceGuildId, premiumRoleIds } = getConfig();
  if (!sourceGuildId || !premiumRoleIds.length) {
    console.log('ℹ️ Premium role access sync disabled (missing PREMIUM_ACCESS_GUILD_ID or PREMIUM_ACCESS_ROLE_IDS).');
    return;
  }

  const guild = client.guilds.cache.get(sourceGuildId) || await client.guilds.fetch(sourceGuildId).catch(() => null);
  if (!guild) {
    console.error(`❌ Premium role access guild ${sourceGuildId} not found.`);
    return;
  }

  const members = await guild.members.fetch();

  for (const member of members.values()) {
    if (member.user.bot) continue;

    if (hasAnyPremiumRole(member, premiumRoleIds)) {
      await grantRoleBasedPremiumAccess(member.id);
    }
  }

  const roleRows = await query(
    `SELECT user_id
     FROM premium_allowed_users
     WHERE source = 'role'`
  );

  for (const row of roleRows) {
    const hasRoleNow = await shouldHaveRolePremium(guild, row.user_id, premiumRoleIds);
    if (!hasRoleNow) {
      await scheduleRoleBasedExpiry(client, row.user_id);
    }
  }
}

function initPremiumAccessManager(client) {
  client.on('guildMemberAdd', member => {
    evaluateMemberPremiumAccess(client, member).catch(err => {
      console.error('❌ Premium access role-eval error (memberAdd):', err);
    });
  });

  client.on('guildMemberUpdate', (_, newMember) => {
    evaluateMemberPremiumAccess(client, newMember).catch(err => {
      console.error('❌ Premium access role-eval error (memberUpdate):', err);
    });
  });

  client.on('guildMemberRemove', member => {
    evaluateMemberPremiumAccess(client, member).catch(err => {
      console.error('❌ Premium access role-eval error (memberRemove):', err);
    });
  });

  const shardId = client.shard?.ids?.[0] ?? 0;
  if (client.shard && shardId !== 0) return;

  runInitialRoleSync(client).catch(err => {
    console.error('❌ Initial premium access role sync failed:', err);
  });

  if (expiryInterval) clearInterval(expiryInterval);

  expiryInterval = setInterval(() => {
    processExpiredRolePremiumAccess(client).catch(err => {
      console.error('❌ Premium access expiry check failed:', err);
    });
  }, 10 * 60 * 1000);
}

module.exports = {
  PREMIUM_GRACE_PERIOD_MS,
  initPremiumAccessManager,
  processExpiredRolePremiumAccess,
  evaluateMemberPremiumAccess
};
