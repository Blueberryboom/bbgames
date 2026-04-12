const { query } = require('../database');

const MESSAGE_WINDOW_MS = 10_000;
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

const channelStates = new Map();
let adjustTimer = null;

function makeState(config) {
  return {
    ...config,
    timestamps: []
  };
}

function pruneOldTimestamps(state, now = Date.now()) {
  const cutoff = now - MESSAGE_WINDOW_MS;
  while (state.timestamps.length && state.timestamps[0] < cutoff) {
    state.timestamps.shift();
  }
}

function trackMessage(message) {
  if (!message?.guildId || !message?.channelId || message.author?.bot) return;

  const state = channelStates.get(message.channelId);
  if (!state || state.guildId !== message.guildId) return;

  state.timestamps.push(Date.now());
  pruneOldTimestamps(state);
}

async function applySlowmode(client, state) {
  const guild = client.guilds.cache.get(state.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(state.channelId)
    || await guild.channels.fetch(state.channelId).catch(() => null);

  if (!channel?.isTextBased() || typeof channel.rateLimitPerUser !== 'number') return;

  pruneOldTimestamps(state);
  const messagesInWindow = state.timestamps.length;

  let targetSlowmode = 0;
  if (messagesInWindow >= 3) {
    targetSlowmode = state.minSlowmode + (messagesInWindow - 3);
  }
  targetSlowmode = Math.max(state.minSlowmode, Math.min(state.maxSlowmode, targetSlowmode));

  if (channel.rateLimitPerUser === targetSlowmode) return;

  const reason = `Variable slowmode auto-adjust: ${messagesInWindow} message(s)/10s (range ${state.minSlowmode}-${state.maxSlowmode}s)`;
  await channel.setRateLimitPerUser(targetSlowmode, reason);
}

async function runAdjustment(client) {
  const states = Array.from(channelStates.values());

  for (const state of states) {
    try {
      await applySlowmode(client, state);
    } catch (err) {
      if (err?.code === 50013 || err?.code === 50001) {
        continue;
      }
      console.error(`❌ Variable slowmode adjustment failed for channel ${state.channelId}:`, err);
    }
  }
}

async function initializeVariableSlowmodeManager(client) {
  const rows = await query(
    `SELECT guild_id, channel_id, min_slowmode, max_slowmode
     FROM variable_slowmode_configs
     WHERE enabled = 1`
  );

  channelStates.clear();

  for (const row of rows) {
    channelStates.set(row.channel_id, makeState({
      guildId: row.guild_id,
      channelId: row.channel_id,
      minSlowmode: Number(row.min_slowmode),
      maxSlowmode: Number(row.max_slowmode)
    }));
  }

  if (adjustTimer) {
    clearInterval(adjustTimer);
    adjustTimer = null;
  }

  adjustTimer = setInterval(() => {
    runAdjustment(client).catch(err => {
      console.error('❌ Variable slowmode scheduler error:', err);
    });
  }, CHECK_INTERVAL_MS);

  adjustTimer.unref?.();
}

function upsertChannelConfig(config) {
  channelStates.set(config.channelId, makeState(config));
}

function removeChannelConfig(channelId) {
  channelStates.delete(channelId);
}

function hasChannelConfig(channelId) {
  return channelStates.has(channelId);
}

module.exports = {
  initializeVariableSlowmodeManager,
  trackMessage,
  upsertChannelConfig,
  removeChannelConfig,
  hasChannelConfig
};
