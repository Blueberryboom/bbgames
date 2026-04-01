const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const ALERT_COOLDOWN_MS = 10_000;
const ALERT_DELETE_AFTER_MS = 6_000;
const MEMORY_SWEEP_MS = 60_000;
const STALE_ALERT_MS = 5 * 60_000;
const LEADERBOARD_ACTIVITY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const afkAlertCooldowns = new Map(); // key: channelId:userId -> last sent timestamp
let sweepInterval = null;

function ensureSweepTask() {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_ALERT_MS;
    for (const [key, value] of afkAlertCooldowns.entries()) {
      if (value < cutoff) afkAlertCooldowns.delete(key);
    }
  }, MEMORY_SWEEP_MS);
  sweepInterval.unref?.();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);
  return parts.slice(0, 3).join(' ');
}

function sanitizeReason(rawReason) {
  if (!rawReason) return 'No reason provided.';
  return rawReason.trim().slice(0, 200) || 'No reason provided.';
}

async function setAfk(userId, guildId, reason, onlyThisServer) {
  const now = Date.now();
  await query(
    `REPLACE INTO afk_status
     (user_id, guild_id, reason, only_this_server, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, guildId, sanitizeReason(reason), onlyThisServer ? 1 : 0, now, now]
  );

  return { startedAt: now };
}

async function getAfk(userId) {
  const rows = await query(
    `SELECT user_id, guild_id, reason, only_this_server, started_at
     FROM afk_status
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function clearAfkForMessage(message) {
  if (!message.guild || !message.author || message.author.bot) return null;

  const now = Date.now();
  await query(
    `INSERT INTO afk_user_activity (user_id, last_online_at, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
      last_online_at = VALUES(last_online_at),
      updated_at = VALUES(updated_at)`,
    [message.author.id, now, now]
  );

  const afk = await getAfk(message.author.id);
  if (!afk) return null;

  const isOnlyThisServer = Boolean(afk.only_this_server);
  if (isOnlyThisServer && afk.guild_id !== message.guild.id) return null;

  await query(`DELETE FROM afk_status WHERE user_id = ?`, [message.author.id]);

  const afkDurationMs = Math.max(0, now - Number(afk.started_at || now));
  await query(
    `INSERT INTO afk_leaderboard (guild_id, user_id, longest_afk_ms, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      longest_afk_ms = GREATEST(longest_afk_ms, VALUES(longest_afk_ms)),
      updated_at = VALUES(updated_at)`,
    [afk.guild_id, message.author.id, afkDurationMs, now]
  );

  return {
    durationMs: afkDurationMs,
    reason: afk.reason || 'No reason provided.'
  };
}

async function notifyMentionedAfkUsers(message) {
  if (!message.guild || !message.mentions?.users?.size || message.author?.bot) return;

  ensureSweepTask();

  const mentionedUsers = [...message.mentions.users.values()]
    .filter(user => !user.bot && user.id !== message.author.id);
  if (!mentionedUsers.length) return;

  for (const user of mentionedUsers) {
    let afk;
    try {
      afk = await getAfk(user.id);
    } catch (error) {
      console.error('❌ Failed to load AFK status:', error);
      continue;
    }

    if (!afk) continue;

    const isOnlyThisServer = Boolean(afk.only_this_server);
    if (isOnlyThisServer && afk.guild_id !== message.guild.id) continue;

    const cooldownKey = `${message.channel.id}:${user.id}`;
    const now = Date.now();
    const lastNotifiedAt = afkAlertCooldowns.get(cooldownKey) || 0;
    if (lastNotifiedAt + ALERT_COOLDOWN_MS > now) continue;
    afkAlertCooldowns.set(cooldownKey, now);

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`${user.username} is AFK!`)
      .setDescription(`They'll be back soon 💛\n**Reason:** ${afk.reason || 'No reason provided.'}`);

    const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) continue;

    setTimeout(() => {
      sent.delete().catch(() => null);
    }, ALERT_DELETE_AFTER_MS).unref?.();
  }
}

async function getAfkLeaderboard(guildId, limit = 10) {
  const cutoff = Date.now() - LEADERBOARD_ACTIVITY_WINDOW_MS;
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));

  return query(
    `SELECT l.user_id, l.longest_afk_ms
     FROM afk_leaderboard l
     INNER JOIN afk_user_activity a ON a.user_id = l.user_id
     WHERE l.guild_id = ?
       AND a.last_online_at >= ?
     ORDER BY l.longest_afk_ms DESC
     LIMIT ${safeLimit}`,
    [guildId, cutoff]
  );
}

module.exports = {
  formatDuration,
  setAfk,
  getAfk,
  clearAfkForMessage,
  notifyMentionedAfkUsers,
  getAfkLeaderboard
};
