const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const CACHE_TTL_MS = 30_000;
const SEND_COOLDOWN_MS = 3_000;
const cache = new Map();
const lastSendAt = new Map();

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function getGuildResponders(guildId) {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.rows;

  const rows = await query(
    `SELECT *
     FROM auto_responders
     WHERE guild_id = ? AND enabled = 1`,
    [guildId]
  );

  cache.set(guildId, { rows, expiresAt: now + CACHE_TTL_MS });
  return rows;
}

function invalidateGuild(guildId) {
  cache.delete(guildId);
  for (const key of lastSendAt.keys()) {
    if (key.startsWith(`${guildId}:`)) lastSendAt.delete(key);
  }
}

function strictMatch(contentLower, triggerWord) {
  const tokens = contentLower.split(/[^a-z0-9_]+/).filter(Boolean);
  return tokens.includes(triggerWord);
}

function wildcardMatch(contentLower, triggerWord) {
  return contentLower.includes(triggerWord);
}

async function handleAutoResponderMessage(message) {
  if (!message.guildId || message.author?.bot || !message.content) return;

  const rows = await getGuildResponders(message.guildId);
  if (!rows.length) return;

  const contentLower = message.content.toLowerCase();
  const now = Date.now();

  for (const row of rows) {
    if (row.disabled_until && Number(row.disabled_until) > now) continue;

    const triggers = parseJson(row.triggers_json, []);
    if (!Array.isArray(triggers) || !triggers.length) continue;

    const whitelist = parseJson(row.channel_whitelist_json, null);
    if (Array.isArray(whitelist) && whitelist.length && !whitelist.includes(message.channelId)) {
      continue;
    }

    const matched = triggers.some(trigger => {
      const word = String(trigger?.word || '').trim().toLowerCase();
      const mode = trigger?.mode === 'strict' ? 'strict' : 'wildcard';
      if (!word) return false;
      return mode === 'strict' ? strictMatch(contentLower, word) : wildcardMatch(contentLower, word);
    });

    if (!matched) continue;

    const throttleKey = `${message.guildId}:${message.channelId}:${row.id}`;
    const previousSend = Number(lastSendAt.get(throttleKey) || 0);
    if (previousSend + SEND_COOLDOWN_MS > now) continue;

    const payload = parseJson(row.response_payload, {});
    if (row.response_type === 'embed') {
      const color = /^#[0-9a-fA-F]{6}$/.test(payload.color || '') ? payload.color : '#3498DB';
      const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(String(payload.description || '...').slice(0, 4000));
      if (payload.title) embed.setTitle(String(payload.title).slice(0, 256));
      if (payload.footer) embed.setFooter({ text: String(payload.footer).slice(0, 2048) });
      await message.channel.send({ embeds: [embed] }).catch(() => null);
    } else {
      await message.channel.send({ content: String(payload.content || '').slice(0, 2000) }).catch(() => null);
    }

    lastSendAt.set(throttleKey, now);
    break;
  }
}

module.exports = {
  handleAutoResponderMessage,
  invalidateGuild
};

setInterval(() => {
  const cutoff = Date.now() - (SEND_COOLDOWN_MS * 4);
  for (const [key, timestamp] of lastSendAt.entries()) {
    if (timestamp < cutoff) lastSendAt.delete(key);
  }
}, 60_000).unref?.();
