const { PermissionsBitField } = require('discord.js');
const { query } = require('../database');
const { invalidatePremiumGuildCache } = require('./premiumPerks');

const PREMIUM_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const REQUIRED_ROLE_NAMES = ['Certified Blueberry', 'Blueberry Premium', 'Blueberry Pro'];
let expiryInterval = null;

function getConfig() {
  return {
    sourceGuildId: process.env.PREMIUM_ACCESS_GUILD_ID
  };
}

function hasAnyPremiumRole(member) {
  return REQUIRED_ROLE_NAMES.some(name => member.roles.cache.some(role => role.name === name));
}

function durationToExpiry(durationType, now = Date.now()) {
  if (durationType === 'lifetime') return null;
  const d = new Date(now);
  if (durationType === '1_month') {
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  if (durationType === '1_year') {
    d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  throw new Error('Unknown license duration type.');
}

async function markGuildPremiumActive(userId) {
  const now = Date.now();
  await query(
    `UPDATE premium_guild_perks
     SET active = 1,
         grace_expires_at = NULL,
         notified_at = NULL,
         updated_at = ?
     WHERE source_user_id = ?`,
    [now, userId]
  );

  const perkRows = await query(
    `SELECT guild_id
     FROM premium_guild_perks
     WHERE source_user_id = ?`,
    [userId]
  );

  for (const row of perkRows) {
    invalidatePremiumGuildCache(row.guild_id);
  }
}

async function grantRoleBasedPremiumAccess(userId) {
  const now = Date.now();

  await query(
    `REPLACE INTO premium_allowed_users
     (user_id, added_at, source, expires_at, notified_at)
     VALUES (?, ?, 'role', NULL, NULL)`,
    [userId, now]
  );

  await markGuildPremiumActive(userId);
}

async function notifyPremiumLoss(client, userId, expiresAt, reasonLabel) {
  const user = await client.users.fetch(userId).catch(() => null);
  const expiryRelative = `<t:${Math.floor(expiresAt / 1000)}:R>`;
  const dmText = `⚠️ Your BBGames premium (${reasonLabel}) needs attention. Regain/renew it within ${expiryRelative} or premium perks will be removed.`;

  let dmSent = false;
  if (user) dmSent = Boolean(await user.send(dmText).catch(() => null));
  if (dmSent) return;

  const guildRows = await query(
    `SELECT pgp.guild_id, c.channel_id AS counting_channel_id, ls.levelup_channel_id,
            (SELECT ys.discord_channel_id
             FROM youtube_subscriptions ys
             WHERE ys.guild_id = pgp.guild_id
             ORDER BY ys.updated_at DESC
             LIMIT 1) AS youtube_channel_id
     FROM premium_guild_perks pgp
     LEFT JOIN counting c ON c.guild_id = pgp.guild_id
     LEFT JOIN leveling_settings ls ON ls.guild_id = pgp.guild_id
     WHERE pgp.source_user_id = ?
       AND pgp.active = 1`,
    [userId]
  );

  for (const row of guildRows) {
    const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id).catch(() => null);
    if (!guild) continue;

    const targetChannels = [row.counting_channel_id, row.levelup_channel_id, row.youtube_channel_id].filter(Boolean);

    for (const channelId of targetChannels) {
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const msg = `⚠️ <@${userId}> premium (${reasonLabel}) needs attention. Renew/regain within ${expiryRelative} to keep perks active.`;
      const sent = await channel.send({ content: msg, allowedMentions: { users: [userId], parse: [] } }).catch(() => null);
      if (sent) return;
    }
  }
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

  if (!rows.length || rows[0].source !== 'role') return;

  const existingExpiry = Number(rows[0].expires_at) || null;
  if (existingExpiry && existingExpiry > now) return;

  await query(
    `UPDATE premium_allowed_users
     SET expires_at = ?, notified_at = ?
     WHERE user_id = ? AND source = 'role'`,
    [expiresAt, now, userId]
  );

  await query(
    `UPDATE premium_guild_perks
     SET grace_expires_at = ?, notified_at = ?, updated_at = ?
     WHERE source_user_id = ?
       AND source_type = 'role'
       AND active = 1`,
    [expiresAt, now, now, userId]
  );

  await notifyPremiumLoss(client, userId, expiresAt, 'role access');
}

async function evaluateMemberPremiumAccess(client, member) {
  const { sourceGuildId } = getConfig();
  if (!sourceGuildId) return;
  if (!member || member.guild.id !== sourceGuildId) return;
  if (member.user.bot) return;

  if (hasAnyPremiumRole(member)) {
    await grantRoleBasedPremiumAccess(member.id);
  } else {
    await scheduleRoleBasedExpiry(client, member.id);
  }
}

async function shouldHaveRolePremium(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) return false;
  return hasAnyPremiumRole(member);
}

async function disableAllPerksForUser(client, userId) {
  const now = Date.now();
  const perkRows = await query(
    `SELECT guild_id
     FROM premium_guild_perks
     WHERE source_user_id = ?
       AND active = 1`,
    [userId]
  );

  await query(
    `UPDATE premium_guild_perks
     SET active = 0,
         updated_at = ?
     WHERE source_user_id = ?`,
    [now, userId]
  );

  for (const perkRow of perkRows) {
    invalidatePremiumGuildCache(perkRow.guild_id);
  }

  try {
    await client.premiumManager.stopPremiumInstance(userId, { persist: true });
  } catch (error) {
    console.error(`⚠️ Failed stopping expired premium instance for ${userId}:`, error.message || error);
  }
}

async function processExpiredRolePremiumAccess(client) {
  const { sourceGuildId } = getConfig();
  if (!sourceGuildId) return;

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
    const hasRoleNow = await shouldHaveRolePremium(guild, userId);

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

    await disableAllPerksForUser(client, userId);
    console.log(`💎 Expired premium role access for ${userId}; disabled premium perks.`);
  }
}

async function processExpiredCodePremiumAccess(client) {
  const now = Date.now();
  const graceUntil = now + PREMIUM_GRACE_PERIOD_MS;

  const newlyExpiredRows = await query(
    `SELECT guild_id, source_user_id
     FROM premium_guild_perks
     WHERE source_type = 'code'
       AND active = 1
       AND expires_at IS NOT NULL
       AND expires_at <= ?
       AND grace_expires_at IS NULL`,
    [now]
  );

  for (const row of newlyExpiredRows) {
    await query(
      `UPDATE premium_guild_perks
       SET grace_expires_at = ?,
           notified_at = ?,
           updated_at = ?
       WHERE guild_id = ?`,
      [graceUntil, now, now, row.guild_id]
    );

    await notifyPremiumLoss(client, row.source_user_id, graceUntil, 'license code');
  }

  const fullyExpiredRows = await query(
    `SELECT guild_id, source_user_id
     FROM premium_guild_perks
     WHERE source_type = 'code'
       AND active = 1
       AND grace_expires_at IS NOT NULL
       AND grace_expires_at <= ?`,
    [now]
  );

  for (const row of fullyExpiredRows) {
    await query(
      `UPDATE premium_guild_perks
       SET active = 0,
           updated_at = ?
       WHERE guild_id = ?`,
      [now, row.guild_id]
    );
    invalidatePremiumGuildCache(row.guild_id);
  }
}

async function runInitialRoleSync(client) {
  const { sourceGuildId } = getConfig();
  if (!sourceGuildId) {
    console.log('ℹ️ Premium role access sync disabled (missing PREMIUM_ACCESS_GUILD_ID).');
    return;
  }

  const guild = client.guilds.cache.get(sourceGuildId) || await client.guilds.fetch(sourceGuildId).catch(() => null);
  if (!guild) {
    console.error(`⚠️ Premium role access guild ${sourceGuildId} not found.`);
    return;
  }

  const members = await guild.members.fetch();

  for (const member of members.values()) {
    if (!member.user.bot && hasAnyPremiumRole(member)) {
      await grantRoleBasedPremiumAccess(member.id);
    }
  }

  const roleRows = await query(
    `SELECT user_id
     FROM premium_allowed_users
     WHERE source = 'role'`
  );

  for (const row of roleRows) {
    const hasRoleNow = await shouldHaveRolePremium(guild, row.user_id);
    if (!hasRoleNow) await scheduleRoleBasedExpiry(client, row.user_id);
  }
}

async function assertRedeemEligibility(client, guildId, userId, code) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error('Could not find this server.');

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('You must be in this server to redeem premium perks.');

  const isOwner = guild.ownerId === userId;
  const hasAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!isOwner && !hasAdmin) {
    throw new Error('You must be the server owner or have the Administrator permission in this server.');
  }

  const activeRows = await query(
    `SELECT guild_id
     FROM premium_guild_perks
     WHERE source_user_id = ?
       AND active = 1
     LIMIT 1`,
    [userId]
  );

  if (activeRows.length && activeRows[0].guild_id !== guildId) {
    throw new Error('You already redeemed premium perks in another server. Use `/premium remove` first.');
  }

  if (code) return { guild, sourceType: 'code' };

  const { sourceGuildId } = getConfig();
  if (!sourceGuildId) throw new Error('Premium access server is not configured.');

  const sourceGuild = client.guilds.cache.get(sourceGuildId) || await client.guilds.fetch(sourceGuildId).catch(() => null);
  if (!sourceGuild) throw new Error('Could not find the premium access server.');

  const sourceMember = await sourceGuild.members.fetch(userId).catch(() => null);
  if (!sourceMember || !hasAnyPremiumRole(sourceMember)) {
    throw new Error('You need one of these roles in the premium server: Certified Blueberry, Blueberry Premium, Blueberry Pro.');
  }

  return { guild, sourceType: 'role' };
}

async function redeemCode(userId, codeInput) {
  const code = codeInput.trim();
  const now = Date.now();

  const rows = await query(
    `SELECT code, deleted_at, redeemed_by_user_id, duration_type
     FROM premium_codes
     WHERE code = ?
     LIMIT 1`,
    [code]
  );

  if (!rows.length) throw new Error('Invalid premium code.');
  const row = rows[0];

  if (Number(row.deleted_at) > 0) throw new Error('This premium code was deleted.');
  if (row.redeemed_by_user_id) throw new Error('This premium code has already been redeemed.');

  const expiresAt = durationToExpiry(row.duration_type, now);

  await query(
    `UPDATE premium_codes
     SET redeemed_by_user_id = ?,
         redeemed_at = ?,
         expires_at = ?
     WHERE code = ?`,
    [userId, now, expiresAt, code]
  );

  return { code, expiresAt };
}

async function redeemPremiumForGuild(client, guildId, userId, code = null) {
  const normalizedCode = code ? code.trim() : null;
  const { guild, sourceType } = await assertRedeemEligibility(client, guildId, userId, normalizedCode);

  let redeemedCode = null;
  if (normalizedCode) {
    redeemedCode = await redeemCode(userId, normalizedCode);
  }

  if (sourceType === 'role') {
    await grantRoleBasedPremiumAccess(userId);
  }

  const now = Date.now();
  await query(
    `INSERT INTO premium_guild_perks
     (guild_id, owner_user_id, source_user_id, source_type, code, active, expires_at, grace_expires_at, notified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       owner_user_id = VALUES(owner_user_id),
       source_user_id = VALUES(source_user_id),
       source_type = VALUES(source_type),
       code = VALUES(code),
       expires_at = VALUES(expires_at),
       active = 1,
       grace_expires_at = NULL,
       notified_at = NULL,
       updated_at = VALUES(updated_at)`,
    [
      guildId,
      guild.ownerId || userId,
      userId,
      sourceType,
      redeemedCode?.code || null,
      redeemedCode?.expiresAt || null,
      now,
      now
    ]
  );

  if (redeemedCode) {
    await query(
      `UPDATE premium_codes
       SET redeemed_guild_id = ?
       WHERE code = ?`,
      [guildId, redeemedCode.code]
    );
  }

  invalidatePremiumGuildCache(guildId);
  return {
    guildName: guild.name,
    sourceType,
    expiresAt: redeemedCode?.expiresAt || null
  };
}

async function removePremiumForUser(userId) {
  const rows = await query(
    `SELECT guild_id
     FROM premium_guild_perks
     WHERE source_user_id = ?
       AND active = 1`,
    [userId]
  );

  if (!rows.length) return { removed: false };

  const now = Date.now();
  await query(
    `UPDATE premium_guild_perks
     SET active = 0,
         updated_at = ?
     WHERE source_user_id = ?`,
    [now, userId]
  );

  for (const row of rows) {
    invalidatePremiumGuildCache(row.guild_id);
  }

  return { removed: true, guildId: rows[0].guild_id };
}

function initPremiumAccessManager(client) {
  client.on('guildMemberAdd', member => {
    evaluateMemberPremiumAccess(client, member).catch(err => {
      console.error('⚠️ Premium access role-eval error (memberAdd):', err);
    });
  });

  client.on('guildMemberUpdate', (_, newMember) => {
    evaluateMemberPremiumAccess(client, newMember).catch(err => {
      console.error('⚠️ Premium access role-eval error (memberUpdate):', err);
    });
  });

  const shardId = client.shard?.ids?.[0] ?? 0;
  if (client.shard && shardId !== 0) return;

  runInitialRoleSync(client).catch(err => {
    console.error('⚠️ Initial premium access role sync failed:', err);
  });

  if (expiryInterval) clearInterval(expiryInterval);
  expiryInterval = setInterval(() => {
    Promise.all([
      processExpiredRolePremiumAccess(client),
      processExpiredCodePremiumAccess(client)
    ]).catch(err => {
      console.error('⚠️ Premium access expiry check failed:', err);
    });
  }, 10 * 60 * 1000);
}

module.exports = {
  PREMIUM_GRACE_PERIOD_MS,
  REQUIRED_ROLE_NAMES,
  initPremiumAccessManager,
  processExpiredRolePremiumAccess,
  processExpiredCodePremiumAccess,
  evaluateMemberPremiumAccess,
  redeemPremiumForGuild,
  removePremiumForUser,
  durationToExpiry
};
