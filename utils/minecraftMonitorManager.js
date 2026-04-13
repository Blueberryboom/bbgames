const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let monitorInterval = null;
const runningSweepClients = new WeakSet();

async function fetchMinecraftServerStats(serverIp) {
  const response = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(serverIp)}`);
  if (!response.ok) {
    throw new Error(`minecraft_api_http_${response.status}`);
  }

  const payload = await response.json();
  const online = Boolean(payload.online);
  const currentPlayers = Number(payload.players?.online || 0);
  const maxPlayers = Number(payload.players?.max || 0);

  return {
    online,
    currentPlayers,
    maxPlayers
  };
}

function sanitizeEmojiPrefix(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return `${trimmed} `;
}

function buildIpChannelName(serverIp, emojiPrefix = '') {
  return `${sanitizeEmojiPrefix(emojiPrefix)}IP: ${serverIp}`.slice(0, 100);
}

function buildPlayersChannelName(displayMaxPlayers, currentPlayers, maxPlayers, online, emojiPrefix = '') {
  if (!online) return `${sanitizeEmojiPrefix(emojiPrefix)}Server Offline`.slice(0, 100);
  if (displayMaxPlayers) return `${sanitizeEmojiPrefix(emojiPrefix)}${currentPlayers}/${maxPlayers} Active Players`.slice(0, 100);
  return `${sanitizeEmojiPrefix(emojiPrefix)}${currentPlayers} Active Players`.slice(0, 100);
}

function buildRecordChannelName(playerRecord, emojiPrefix = '') {
  return `${sanitizeEmojiPrefix(emojiPrefix)}Record: ${playerRecord} Players`.slice(0, 100);
}

function buildVoiceOverwrite(guild) {
  return {
    id: guild.roles.everyone.id,
    deny: [PermissionFlagsBits.Connect]
  };
}

async function ensureVoiceChannel(guild, existingChannelId, desiredName) {
  if (!desiredName) return null;

  const existing = existingChannelId
    ? (guild.channels.cache.get(existingChannelId)
      || await guild.channels.fetch(existingChannelId).catch(() => null))
    : null;

  if (existing && existing.type === ChannelType.GuildVoice) {
    const updates = {};
    if (existing.name !== desiredName) updates.name = desiredName;

    const everyoneOverwrite = existing.permissionOverwrites.cache.get(guild.roles.everyone.id);
    if (!everyoneOverwrite?.deny?.has(PermissionFlagsBits.Connect)) {
      updates.permissionOverwrites = [buildVoiceOverwrite(guild)];
    }

    if (Object.keys(updates).length) {
      await existing.edit(updates).catch(() => null);
    }

    return existing.id;
  }

  const created = await guild.channels.create({
    name: desiredName,
    type: ChannelType.GuildVoice,
    permissionOverwrites: [buildVoiceOverwrite(guild)]
  });

  return created.id;
}

async function applyTopPositions(guild, channelIds) {
  const uniqueIds = [...new Set(channelIds.filter(Boolean))];
  if (!uniqueIds.length) return;

  const positionUpdates = uniqueIds.map((channelId, index) => ({
    channel: channelId,
    position: index
  }));

  await guild.channels.setPositions(positionUpdates).catch(() => null);
}

async function deleteMonitorChannels(guild, monitorConfig) {
  const channelIds = [
    monitorConfig?.ip_channel_id,
    monitorConfig?.players_channel_id,
    monitorConfig?.record_channel_id
  ].filter(Boolean);

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) continue;
    await channel.delete('Minecraft monitor stopped').catch(() => null);
  }
}

async function syncGuildMonitor(client, guildId) {
  const rows = await query(
    `SELECT guild_id, server_ip, display_ip, display_player_count, display_max_players, display_player_record,
            ip_channel_id, players_channel_id, record_channel_id, player_record, ip_emoji, players_emoji, record_emoji
     FROM minecraft_monitors
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );

  const monitorConfig = rows[0];
  if (!monitorConfig) return;

  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  let stats;
  try {
    stats = await fetchMinecraftServerStats(monitorConfig.server_ip);
  } catch {
    stats = {
      online: false,
      currentPlayers: 0,
      maxPlayers: 0
    };
  }

  const playerRecord = Math.max(Number(monitorConfig.player_record || 0), stats.currentPlayers);

  const ipName = Number(monitorConfig.display_ip) ? buildIpChannelName(monitorConfig.server_ip, monitorConfig.ip_emoji) : null;
  const playersName = Number(monitorConfig.display_player_count)
    ? buildPlayersChannelName(Number(monitorConfig.display_max_players) === 1, stats.currentPlayers, stats.maxPlayers, stats.online, monitorConfig.players_emoji)
    : null;
  const recordName = Number(monitorConfig.display_player_record)
    ? buildRecordChannelName(playerRecord, monitorConfig.record_emoji)
    : null;

  const ipChannelId = await ensureVoiceChannel(guild, monitorConfig.ip_channel_id, ipName);
  const playersChannelId = await ensureVoiceChannel(guild, monitorConfig.players_channel_id, playersName);
  const recordChannelId = await ensureVoiceChannel(guild, monitorConfig.record_channel_id, recordName);

  const now = Date.now();
  await query(
    `UPDATE minecraft_monitors
     SET ip_channel_id = ?,
         players_channel_id = ?,
         record_channel_id = ?,
         current_players = ?,
         max_players = ?,
         player_record = ?,
         last_online = ?,
         last_checked_at = ?,
         updated_at = ?
     WHERE guild_id = ?`,
    [
      ipChannelId,
      playersChannelId,
      recordChannelId,
      stats.currentPlayers,
      stats.maxPlayers,
      playerRecord,
      stats.online ? 1 : 0,
      now,
      now,
      guildId
    ]
  );

  await applyTopPositions(guild, [ipChannelId, playersChannelId, recordChannelId]);
}

async function runSweep(client) {
  if (runningSweepClients.has(client)) return;
  runningSweepClients.add(client);

  try {
    const monitors = await query('SELECT guild_id FROM minecraft_monitors');
    for (const monitor of monitors) {
      try {
        await syncGuildMonitor(client, monitor.guild_id);
      } catch (error) {
        console.error(`❌ Minecraft monitor sync failed for guild ${monitor.guild_id}:`, error.message || error);
      }
    }
  } finally {
    runningSweepClients.delete(client);
  }
}

function stopMinecraftMonitorManager() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

function initMinecraftMonitorManager(client) {
  const shardId = client.shard?.ids?.[0] ?? 0;
  if (client.shard && shardId !== 0) return;

  stopMinecraftMonitorManager();

  runSweep(client).catch(err => {
    console.error('❌ Initial Minecraft monitor sweep failed:', err.message || err);
  });

  monitorInterval = setInterval(() => {
    runSweep(client).catch(err => {
      console.error('❌ Minecraft monitor sweep failed:', err.message || err);
    });
  }, CHECK_INTERVAL_MS);

  monitorInterval.unref?.();
}

module.exports = {
  CHECK_INTERVAL_MS,
  fetchMinecraftServerStats,
  syncGuildMonitor,
  deleteMonitorChannels,
  initMinecraftMonitorManager,
  stopMinecraftMonitorManager
};
