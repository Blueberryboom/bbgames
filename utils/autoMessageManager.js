const { query } = require('../database');

const stateByClient = new WeakMap();

function getState(client) {
  if (!stateByClient.has(client)) {
    stateByClient.set(client, {
      timers: new Map(),
      messageGuildById: new Map()
    });
  }

  return stateByClient.get(client);
}

function clearMessageTimer(client, messageId) {
  const state = getState(client);
  const timer = state.timers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    state.timers.delete(messageId);
  }
  state.messageGuildById.delete(messageId);
}

function stopAutoMessageSchedulers(client) {
  const state = getState(client);
  for (const timer of state.timers.values()) {
    clearTimeout(timer);
  }
  state.timers.clear();
  state.messageGuildById.clear();
}

function clearGuildAutoMessages(client, guildId) {
  if (!guildId) return;

  const state = getState(client);
  for (const [messageId, mappedGuildId] of state.messageGuildById.entries()) {
    if (mappedGuildId === guildId) {
      clearMessageTimer(client, messageId);
    }
  }
}

async function dispatchAutoMessage(client, messageId) {
  const rows = await query(
    `SELECT id, guild_id, channel_id, content, interval_ms, next_run_at, enabled
     FROM auto_messages
     WHERE id = ?
     LIMIT 1`,
    [messageId]
  );

  if (!rows.length) {
    clearMessageTimer(client, messageId);
    return;
  }

  const config = rows[0];
  if (!Number(config.enabled)) {
    clearMessageTimer(client, messageId);
    return;
  }

  const guild = client.guilds.cache.get(config.guild_id);
  if (!guild) {
    clearMessageTimer(client, messageId);
    return;
  }

  const channel = await guild.channels.fetch(config.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(config.content).catch(() => null);
  }

  const intervalMs = Number(config.interval_ms) || 30 * 60 * 1000;
  const nextRunAt = Date.now() + intervalMs;

  await query(
    `UPDATE auto_messages
     SET next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextRunAt, Date.now(), messageId]
  );

  await refreshAutoMessageSchedule(client, messageId);
}

function queueAutoMessage(client, config) {
  const id = Number(config.id);
  if (!id) return;

  const state = getState(client);
  clearMessageTimer(client, id);

  if (!Number(config.enabled)) {
    return;
  }

  const nextRunAt = Number(config.next_run_at) || Date.now();
  const delay = Math.max(1000, nextRunAt - Date.now());

  const timer = setTimeout(() => {
    dispatchAutoMessage(client, id).catch(error => {
      console.error('⚠️ Auto message dispatch failed:', error);
      refreshAutoMessageSchedule(client, id).catch(() => null);
    });
  }, delay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  state.timers.set(id, timer);
  state.messageGuildById.set(id, config.guild_id);
}

async function refreshAutoMessageSchedule(client, messageId) {
  const rows = await query(
    `SELECT id, guild_id, channel_id, content, interval_ms, next_run_at, enabled
     FROM auto_messages
     WHERE id = ?
     LIMIT 1`,
    [messageId]
  );

  if (!rows.length) {
    clearMessageTimer(client, Number(messageId));
    return;
  }

  queueAutoMessage(client, rows[0]);
}

async function initializeAutoMessageScheduler(client) {
  stopAutoMessageSchedulers(client);

  const rows = await query(
    `SELECT id, guild_id, channel_id, content, interval_ms, next_run_at, enabled
     FROM auto_messages
     WHERE enabled = 1`
  );

  for (const row of rows) {
    if (!client.guilds.cache.has(row.guild_id)) continue;
    queueAutoMessage(client, row);
  }
}

function getAutoMessageLimit(client) {
  return client?.isPremiumInstance ? 10 : 2;
}

module.exports = {
  getAutoMessageLimit,
  initializeAutoMessageScheduler,
  refreshAutoMessageSchedule,
  clearGuildAutoMessages,
  stopAutoMessageSchedulers
};
