const { PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');

const CHECK_INTERVAL_MS = 60 * 1000;
let interval = null;
const processingGuilds = new Set();

function parseDurationMs(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const matches = [...raw.toLowerCase().matchAll(/(\d+)\s*([dhm])/g)];
  if (!matches.length) return null;
  let total = 0;
  for (const [, amountRaw, unit] of matches) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === 'd') total += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') total += amount * 60 * 60 * 1000;
    if (unit === 'm') total += amount * 60 * 1000;
  }
  return total;
}

async function trackChannelActivity(message) {
  if (!message?.guildId || message.author?.bot || !message.channelId) return;
  await query(
    `UPDATE auto_revive_configs
     SET last_activity_at = ?, updated_at = ?
     WHERE guild_id = ? AND channel_id = ?`,
    [Date.now(), Date.now(), message.guildId, message.channelId]
  ).catch(() => null);
}

async function processGuild(client, config) {
  const guild = client.guilds.cache.get(config.guild_id) || await client.guilds.fetch(config.guild_id).catch(() => null);
  if (!guild) return;

  const channel = guild.channels.cache.get(config.channel_id) || await guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return;

  const now = Date.now();
  const lastActivityAt = Number(config.last_activity_at || 0);
  const lastSentAt = Number(config.last_sent_at || 0);
  const triggerMs = Number(config.inactivity_ms || 0);

  if (!triggerMs || now - lastActivityAt < triggerMs) return;
  if (lastSentAt && now - lastSentAt < triggerMs) return;

  const roleMention = config.ping_role_id ? `<@&${config.ping_role_id}>` : '';
  const template = (config.message_template || "Hey, let's get this chat rolling again! [$role]").slice(0, 100);
  const finalMessage = template.replace(/\[\$role\]/g, roleMention).trim();

  await channel.send({
    content: finalMessage || roleMention,
    allowedMentions: { parse: config.ping_role_id ? ['roles'] : [] }
  }).catch(() => null);

  await query(
    `UPDATE auto_revive_configs
     SET last_sent_at = ?, updated_at = ?
     WHERE guild_id = ?`,
    [now, now, config.guild_id]
  ).catch(() => null);
}

async function runSweep(client) {
  const rows = await query(
    `SELECT guild_id, channel_id, ping_role_id, inactivity_ms, message_template, last_activity_at, last_sent_at
     FROM auto_revive_configs`
  );

  for (const row of rows) {
    if (processingGuilds.has(row.guild_id)) continue;
    processingGuilds.add(row.guild_id);
    try {
      await processGuild(client, row);
    } catch (error) {
      console.error('Auto revive processing error:', row.guild_id, error?.message || error);
    } finally {
      processingGuilds.delete(row.guild_id);
    }
  }
}

function initAutoReviveManager(client) {
  if (interval) clearInterval(interval);
  runSweep(client).catch(() => null);
  interval = setInterval(() => {
    runSweep(client).catch(() => null);
  }, CHECK_INTERVAL_MS);
  interval.unref?.();
}

module.exports = {
  parseDurationMs,
  trackChannelActivity,
  initAutoReviveManager
};
