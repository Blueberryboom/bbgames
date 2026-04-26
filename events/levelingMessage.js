const { query } = require('../database');
const {
  getGuildLevelingSettings,
  difficultyMultiplier,
  xpForNextLevel,
  renderLevelMessage
} = require('../utils/levelingSystem');
const { guildHasPremiumPerks } = require('../utils/premiumPerks');

const rewardsCache = new Map();
const REWARD_CACHE_TTL_MS = 60 * 1000;

module.exports = async function handleLevelingMessage(message) {
  try {
    if (!message.guild || message.author?.bot) return;

    // Some gateway events can arrive without a hydrated GuildMember object.
    // Fetching here prevents XP from silently never updating for those users.
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    const settings = await getGuildLevelingSettings(message.guild.id);
    if (!settings.enabled) {
      // Guild leveling remains inactive until /leveling config is run.
      return;
    }

    const premiumEnabled = await guildHasPremiumPerks(message.client, message.guild.id);
    if (!premiumEnabled) {
      const rewardRows = await query(
        `SELECT COUNT(*) AS total
         FROM leveling_role_rewards
         WHERE guild_id = ?`,
        [message.guild.id]
      );

      if (Number(rewardRows[0]?.total || 0) > 15) {
        return;
      }
    }

    if (settings.channelMode === 'whitelist' && settings.channelIds.length && !settings.channelIds.includes(message.channel.id)) {
      return;
    }

    if (settings.channelMode === 'blacklist' && settings.channelIds.includes(message.channel.id)) {
      return;
    }

    const existingRows = await query(
      `SELECT xp, level, last_xp_at
       FROM leveling_users
       WHERE guild_id = ? AND user_id = ?
       LIMIT 1`,
      [message.guild.id, message.author.id]
    );

    const now = Date.now();
    const baseXp = 8;
    const cooldownMs = 18_000;

    const current = existingRows[0] || { xp: 0, level: 0, last_xp_at: 0 };
    if (Number(current.last_xp_at || 0) + cooldownMs > now) {
      return;
    }

    // Check boost roles against the resolved member object (cached or freshly fetched).
    const userHasBoostRole = settings.boostRoleIds.some(roleId => member.roles.cache.has(roleId));
    const boostMultiplier = userHasBoostRole ? 1.7 : 1;
    const gainedXp = Math.max(1, Math.floor(baseXp * boostMultiplier / difficultyMultiplier(settings.difficulty)));

    let xp = Number(current.xp || 0) + gainedXp;
    let level = Number(current.level || 0);

    const rewardMap = await getRewardMap(message.guild.id);
    while (xp >= xpForNextLevel(level)) {
      xp -= xpForNextLevel(level);
      level += 1;
    }

    await query(
      `REPLACE INTO leveling_users (guild_id, user_id, xp, level, last_xp_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [message.guild.id, message.author.id, xp, level, now, now]
    );

    await query(
      `INSERT INTO leveling_xp_events (guild_id, user_id, xp_gained, created_at)
       VALUES (?, ?, ?, ?)`,
      [message.guild.id, message.author.id, gainedXp, now]
    );

    if (level === Number(current.level || 0)) {
      return;
    }

    const grantedRoleMention = await syncRewardRoles({
      guild: message.guild,
      member,
      rewardMap,
      level
    });

    const outputChannel = settings.levelup_channel_id
      ? await message.guild.channels.fetch(settings.levelup_channel_id).catch(() => null)
      : message.channel;

    if (!outputChannel?.isTextBased()) return;

    const template = grantedRoleMention ? settings.message_with_role : settings.message_without_role;
    const rendered = renderLevelMessage(template, {
      userMention: `<@${message.author.id}>`,
      level,
      roleMention: grantedRoleMention
    });

    await outputChannel.send({
      content: rendered,
      allowedMentions: { parse: [], users: [message.author.id] }
    }).catch(() => null);
  } catch (error) {
    console.error('<:warning:1496193692099285255> Leveling message handler failed:', error);
  }
};

async function syncRewardRoles({ guild, member, rewardMap, level }) {
  const rewardEntries = [...rewardMap.entries()];
  const eligibleRoleIds = rewardEntries
    .filter(([requiredLevel]) => Number(requiredLevel) <= level)
    .map(([, roleId]) => roleId);
  const rewardRoleIds = rewardEntries.map(([, roleId]) => roleId);

  let firstGrantedRoleLabel = null;

  for (const roleId of eligibleRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role || member.roles.cache.has(roleId)) continue;

    try {
      await member.roles.add(roleId, `Level reward sync for level ${level}`);
      if (!firstGrantedRoleLabel) firstGrantedRoleLabel = `@${role.name}`;
    } catch (error) {
      console.warn('⚠️ Could not assign level reward role:', error?.message || error);
    }
  }

  for (const roleId of rewardRoleIds) {
    if (eligibleRoleIds.includes(roleId) || !member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.remove(roleId, `Level reward sync for level ${level}`);
    } catch (error) {
      console.warn('⚠️ Could not remove level reward role:', error?.message || error);
    }
  }

  return firstGrantedRoleLabel;
}

async function getRewardMap(guildId) {
  const now = Date.now();
  const cached = rewardsCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const rows = await query(
    `SELECT level_required, role_id
     FROM leveling_role_rewards
     WHERE guild_id = ?`,
    [guildId]
  );

  const rewardMap = new Map();
  for (const row of rows) {
    rewardMap.set(Number(row.level_required), row.role_id);
  }

  rewardsCache.set(guildId, { value: rewardMap, expiresAt: now + REWARD_CACHE_TTL_MS });
  return rewardMap;
}
