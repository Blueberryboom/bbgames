const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const LOG_EVENT_KEYS = {
  joins: 'joins',
  leaves: 'leaves',
  boosts: 'boosts',
  bot_setting_changes: 'bot_setting_changes',
  configuration_changes: 'configuration_changes',
  leveling_changes: 'leveling_changes',
  data_deletions: 'data_deletions',
  modules_enabled: 'modules_enabled',
  modules_disabled: 'modules_disabled',
  say_command_used: 'say_command_used'
};

const ALL_LOG_EVENT_KEYS = Object.values(LOG_EVENT_KEYS);

async function isLogTypeEnabled(guildId, eventKey) {
  const rows = await query(
    `SELECT enabled
     FROM guild_logs_events
     WHERE guild_id = ? AND event_key = ?
     LIMIT 1`,
    [guildId, eventKey]
  );

  return Number(rows[0]?.enabled ?? 0) === 1;
}

function normaliseLogPayload(payload, eventKey) {
  if (!payload) return null;

  if (typeof payload === 'string') {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`Log Event • ${eventKey.replaceAll('_', ' ')}`)
          .setDescription(payload)
          .setTimestamp()
      ],
      allowedMentions: { parse: [] }
    };
  }

  if (payload instanceof EmbedBuilder) {
    return {
      embeds: [payload.setTimestamp()],
      allowedMentions: { parse: [] }
    };
  }

  if (typeof payload === 'object') {
    const embed = new EmbedBuilder()
      .setColor(payload.color ?? 0x5865F2)
      .setTitle(payload.title || `Log Event • ${eventKey.replaceAll('_', ' ')}`)
      .setTimestamp();

    if (payload.description) embed.setDescription(payload.description);
    if (Array.isArray(payload.fields) && payload.fields.length) embed.addFields(payload.fields);
    if (payload.footer) embed.setFooter({ text: payload.footer });

    return {
      embeds: [embed],
      allowedMentions: { parse: [] }
    };
  }

  return null;
}

async function logGuildEvent(client, guildId, eventKey, payload) {
  if (!client || !guildId || !eventKey || !payload) return false;

  const settingsRows = await query(
    `SELECT channel_id, enabled
     FROM guild_logs_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );

  if (!settingsRows.length || Number(settingsRows[0].enabled) !== 1) {
    return false;
  }

  if (!await isLogTypeEnabled(guildId, eventKey)) {
    return false;
  }

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;

  const channel = await guild.channels.fetch(settingsRows[0].channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const logPayload = normaliseLogPayload(payload, eventKey);
  if (!logPayload) return false;

  await channel.send(logPayload).catch(() => null);

  return true;
}

module.exports = {
  LOG_EVENT_KEYS,
  ALL_LOG_EVENT_KEYS,
  logGuildEvent
};
