const { query } = require('../database');

const WINDOW_SLICE_MS = 5_000;
const WINDOW_SLICES = 12; // 1 minute / 5 seconds
const ADJUST_INTERVAL_MS = 15 * 1000;

const channelStates = new Map();
let adjustTimer = null;

function makeState(config) {
  return {
    ...config,
    buckets: new Uint16Array(WINDOW_SLICES),
    totalCount: 0,
    bucketIndex: 0,
    lastTick: Math.floor(Date.now() / WINDOW_SLICE_MS)
  };
}

function advanceState(state, now = Date.now()) {
  const currentTick = Math.floor(now / WINDOW_SLICE_MS);
  let delta = currentTick - state.lastTick;
  if (delta <= 0) return;

  if (delta >= WINDOW_SLICES) {
    state.buckets.fill(0);
    state.totalCount = 0;
    state.bucketIndex = 0;
    state.lastTick = currentTick;
    return;
  }

  while (delta > 0) {
    state.bucketIndex = (state.bucketIndex + 1) % WINDOW_SLICES;
    state.totalCount -= state.buckets[state.bucketIndex];
    state.buckets[state.bucketIndex] = 0;
    delta -= 1;
  }

  state.lastTick = currentTick;
}

function trackMessage(message) {
  if (!message?.guildId || !message?.channelId || message.author?.bot) return;

  const state = channelStates.get(message.channelId);
  if (!state || state.guildId !== message.guildId) return;

  advanceState(state);

  const currentValue = state.buckets[state.bucketIndex];
  if (currentValue < 65535) {
    state.buckets[state.bucketIndex] = currentValue + 1;
    state.totalCount += 1;
  }
}

async function applySlowmode(client, state) {
  const guild = client.guilds.cache.get(state.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(state.channelId)
    || await guild.channels.fetch(state.channelId).catch(() => null);

  if (!channel?.isTextBased() || typeof channel.rateLimitPerUser !== 'number') return;

  advanceState(state);

  const avgMessagesPerFiveSeconds = state.totalCount / WINDOW_SLICES;
  const targetSlowmode = Math.max(
    state.minSlowmode,
    Math.min(state.maxSlowmode, Math.round(avgMessagesPerFiveSeconds))
  );

  if (channel.rateLimitPerUser === targetSlowmode) {
    return;
  }

  const reason = `Variable slowmode auto-adjust: ${avgMessagesPerFiveSeconds.toFixed(2)} msgs/5s over 1m (range ${state.minSlowmode}-${state.maxSlowmode}s)`;

  await channel.setRateLimitPerUser(targetSlowmode, reason);
}

async function runAdjustment(client) {
  const states = Array.from(channelStates.values());

  for (const state of states) {
    try {
      await applySlowmode(client, state);
    } catch (err) {
      if (err?.code === 50013 || err?.code === 50001) {
        // Missing permissions/access; keep config and retry later if permissions are fixed.
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
  }, ADJUST_INTERVAL_MS);

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
