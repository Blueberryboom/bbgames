const { ChannelType } = require('discord.js');
const net = require('net');
const dns = require('dns').promises;
const { query } = require('../database');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let monitorInterval = null;
const runningSweepClients = new WeakSet();

function encodeVarInt(value) {
  const out = [];
  let val = value >>> 0;
  do {
    let temp = val & 0x7F;
    val >>>= 7;
    if (val !== 0) temp |= 0x80;
    out.push(temp);
  } while (val !== 0);
  return Buffer.from(out);
}

function buildPacket(id, data = Buffer.alloc(0)) {
  const body = Buffer.concat([encodeVarInt(id), data]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

async function resolveServerAddress(input) {
  const trimmed = String(input || '').trim();
  const [hostRaw, portRaw] = trimmed.split(':');
  let host = hostRaw;
  let port = Number(portRaw || 25565);

  const srvRecords = await dns.resolveSrv(`_minecraft._tcp.${host}`).catch(() => []);
  if (srvRecords.length && !portRaw) {
    host = srvRecords[0].name;
    port = Number(srvRecords[0].port || 25565);
  }

  return { host, port, resolvedHostForHandshake: hostRaw, displayIp: trimmed };
}

async function fetchMinecraftServerStats(serverIp) {
  const target = await resolveServerAddress(serverIp);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('minecraft_ping_timeout'));
    }, 5000);

    const chunks = [];

    socket.once('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.once('connect', () => {
      const hostBuf = Buffer.from(target.resolvedHostForHandshake, 'utf8');
      const handshakeData = Buffer.concat([
        encodeVarInt(760),
        encodeVarInt(hostBuf.length),
        hostBuf,
        Buffer.from([target.port >> 8, target.port & 0xFF]),
        encodeVarInt(1)
      ]);

      socket.write(buildPacket(0x00, handshakeData));
      socket.write(buildPacket(0x00));
    });

    socket.on('data', data => {
      chunks.push(data);
      const full = Buffer.concat(chunks);
      try {
        let offset = 0;
        const readVarInt = () => {
          let num = 0; let shift = 0; let byte;
          do {
            if (offset >= full.length) throw new Error('incomplete');
            byte = full[offset++];
            num |= (byte & 0x7F) << shift;
            shift += 7;
          } while (byte & 0x80);
          return num;
        };

        readVarInt();
        const packetId = readVarInt();
        if (packetId !== 0x00) throw new Error('unexpected_packet');
        const jsonLength = readVarInt();
        if (offset + jsonLength > full.length) throw new Error('incomplete');

        const payload = JSON.parse(full.subarray(offset, offset + jsonLength).toString('utf8'));
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          online: true,
          currentPlayers: Number(payload.players?.online || 0),
          maxPlayers: Number(payload.players?.max || 0)
        });
      } catch (error) {
        if (error.message !== 'incomplete') {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
        }
      }
    });
  });
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

function formatDiscordError(error) {
  if (!error) return 'unknown_error';
  return error.code ? `${error.code}: ${error.message}` : (error.message || String(error));
}


async function ensureVoiceChannel(guild, existingChannelId, desiredName) {
  if (!desiredName) {
    if (existingChannelId) {
      const existing = guild.channels.cache.get(existingChannelId)
        || await guild.channels.fetch(existingChannelId).catch(() => null);
      if (existing) {
        await existing.delete('Minecraft monitor channel disabled');
      }
    }
    return null;
  }

  const existing = existingChannelId
    ? (guild.channels.cache.get(existingChannelId)
      || await guild.channels.fetch(existingChannelId).catch(() => null))
    : null;

  if (existing && existing.type === ChannelType.GuildVoice) {
    if (existing.name !== desiredName) {
      await existing.edit({ name: desiredName });
    }

    return existing.id;
  }

  const created = await guild.channels.create({
    name: desiredName,
    type: ChannelType.GuildVoice
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
  const result = {
    deleted: [],
    missing: [],
    failed: []
  };
  const channelIds = [
    monitorConfig?.ip_channel_id,
    monitorConfig?.players_channel_id,
    monitorConfig?.record_channel_id
  ].filter(Boolean);

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      result.missing.push(channelId);
      continue;
    }

    try {
      await channel.delete('Minecraft monitor stopped');
      result.deleted.push(channelId);
    } catch (error) {
      result.failed.push({
        channelId,
        reason: formatDiscordError(error)
      });
    }
  }

  return result;
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

  let ipChannelId = monitorConfig.ip_channel_id || null;
  let playersChannelId = monitorConfig.players_channel_id || null;
  let recordChannelId = monitorConfig.record_channel_id || null;

  try {
    ipChannelId = await ensureVoiceChannel(guild, monitorConfig.ip_channel_id, ipName);
  } catch {}

  try {
    playersChannelId = await ensureVoiceChannel(guild, monitorConfig.players_channel_id, playersName);
  } catch {}

  try {
    recordChannelId = await ensureVoiceChannel(guild, monitorConfig.record_channel_id, recordName);
  } catch {}

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
    const guildIds = [...client.guilds.cache.keys()];
    if (!guildIds.length) return;

    const placeholders = guildIds.map(() => '?').join(',');
    const monitors = await query(`SELECT guild_id FROM minecraft_monitors WHERE guild_id IN (${placeholders})`, guildIds);

    for (const monitor of monitors) {
      try {
        await syncGuildMonitor(client, monitor.guild_id);
      } catch (error) {
        console.error(`<:warning:1496193692099285255> Minecraft monitor sync failed for guild ${monitor.guild_id}:`, error.message || error);
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
  stopMinecraftMonitorManager();

  runSweep(client).catch(err => {
    console.error('<:warning:1496193692099285255> Initial Minecraft monitor sweep failed:', err.message || err);
  });

  monitorInterval = setInterval(() => {
    runSweep(client).catch(err => {
      console.error('<:warning:1496193692099285255> Minecraft monitor sweep failed:', err.message || err);
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
