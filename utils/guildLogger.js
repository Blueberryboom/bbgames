const { query } = require('../database');

const LOG_EVENT_KEYS = {
  joins: 'joins',
  leaves: 'leaves',
  boosts: 'boosts',
  bot_setting_changes: 'bot_setting_changes',
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

async function logGuildEvent(client, guildId, eventKey, content) {
  if (!client || !guildId || !eventKey || !content) return false;

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

  await channel.send({
    content,
    allowedMentions: { parse: [] }
  }).catch(() => null);

  return true;
}

module.exports = {
  LOG_EVENT_KEYS,
  ALL_LOG_EVENT_KEYS,
  logGuildEvent
};
