const { query } = require('../database');

const DEFAULT_COOLDOWN_MS = 8000;
const MAX_COOLDOWN_MS = 30000;

const resendTimersByChannel = new Map();

async function handleStickyMessage(message) {
  if (!message?.guildId || message.author?.bot) return;

  const channelId = message.channelId;
  const guildId = message.guildId;

  const rows = await query(
    `SELECT id, content, last_post_message_id, cooldown_ms
     FROM sticky_messages
     WHERE guild_id = ? AND channel_id = ? AND enabled = 1
     LIMIT 1`,
    [guildId, channelId]
  );

  if (!rows.length) {
    cancelStickySchedule(channelId);
    return;
  }

  const sticky = rows[0];
  const cooldownMs = Math.min(MAX_COOLDOWN_MS, Math.max(2000, Number(sticky.cooldown_ms) || DEFAULT_COOLDOWN_MS));

  if (sticky.last_post_message_id) {
    await message.channel.messages.delete(sticky.last_post_message_id).catch(() => null);
    await query(
      `UPDATE sticky_messages
       SET last_post_message_id = NULL, updated_at = ?
       WHERE id = ?`,
      [Date.now(), sticky.id]
    );
  }

  cancelStickySchedule(channelId);

  const timer = setTimeout(async () => {
    resendTimersByChannel.delete(channelId);

    const freshRows = await query(
      `SELECT id, content
       FROM sticky_messages
       WHERE guild_id = ? AND channel_id = ? AND enabled = 1
       LIMIT 1`,
      [guildId, channelId]
    );

    if (!freshRows.length) return;

    const stickyMessage = await message.channel.send(freshRows[0].content).catch(() => null);
    if (!stickyMessage) return;

    await query(
      `UPDATE sticky_messages
       SET last_post_message_id = ?, last_post_at = ?, updated_at = ?
       WHERE id = ?`,
      [stickyMessage.id, Date.now(), Date.now(), freshRows[0].id]
    );
  }, cooldownMs);

  resendTimersByChannel.set(channelId, timer);
}

function cancelStickySchedule(channelId) {
  const existingTimer = resendTimersByChannel.get(channelId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    resendTimersByChannel.delete(channelId);
  }
}

function getStickyLimit(client) {
  return client?.isPremiumInstance ? 10 : 2;
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  getStickyLimit,
  handleStickyMessage,
  cancelStickySchedule
};
