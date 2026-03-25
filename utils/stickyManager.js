const { query } = require('../database');

const DEFAULT_COOLDOWN_MS = 8000;
const MAX_COOLDOWN_MS = 30000;

const lastActivityByChannel = new Map();

async function handleStickyMessage(message) {
  if (!message?.guildId || message.author?.bot) return;

  const channelId = message.channelId;
  const guildId = message.guildId;

  const now = Date.now();
  const previous = lastActivityByChannel.get(channelId);
  if (previous && now - previous < 500) {
    return;
  }
  lastActivityByChannel.set(channelId, now);

  const rows = await query(
    `SELECT id, content, last_post_message_id, last_post_at, cooldown_ms
     FROM sticky_messages
     WHERE guild_id = ? AND channel_id = ? AND enabled = 1
     LIMIT 1`,
    [guildId, channelId]
  );

  if (!rows.length) return;

  const sticky = rows[0];
  const cooldownMs = Math.min(MAX_COOLDOWN_MS, Math.max(2000, Number(sticky.cooldown_ms) || DEFAULT_COOLDOWN_MS));
  const lastPostAt = Number(sticky.last_post_at) || 0;

  if (now - lastPostAt < cooldownMs) {
    return;
  }

  if (sticky.last_post_message_id) {
    await message.channel.messages.delete(sticky.last_post_message_id).catch(() => null);
  }

  const stickyMsg = await message.channel.send(`📌 ${sticky.content}`).catch(() => null);
  if (!stickyMsg) return;

  await query(
    `UPDATE sticky_messages
     SET last_post_message_id = ?, last_post_at = ?, updated_at = ?
     WHERE id = ?`,
    [stickyMsg.id, now, now, sticky.id]
  );
}

function getStickyLimit(client) {
  return client?.isPremiumInstance ? 10 : 2;
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  getStickyLimit,
  handleStickyMessage
};
