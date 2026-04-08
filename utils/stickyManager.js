const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const DEFAULT_COOLDOWN_MS = 8000;
const MAX_COOLDOWN_MS = 30000;

const resendTimersByChannel = new Map();

async function handleStickyMessage(message) {
  if (!message?.guildId || message.author?.bot) return;

  const channelId = message.channelId;
  const guildId = message.guildId;

  const rows = await query(
    `SELECT id, content, is_embed, embed_footer_text, button_label, button_url, last_post_message_id, cooldown_ms
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
    const removedPreviousSticky = await removeStickyPost(message.channel, sticky.last_post_message_id);

    // If we cannot reliably remove the old sticky (permissions/etc), do not post a
    // new one to avoid duplicate sticky messages piling up after restarts.
    if (!removedPreviousSticky) {
      cancelStickySchedule(channelId);
      return;
    }

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
      `SELECT id, content, is_embed, embed_footer_text, button_label, button_url, last_post_message_id
       FROM sticky_messages
       WHERE guild_id = ? AND channel_id = ? AND enabled = 1
       LIMIT 1`,
      [guildId, channelId]
    );

    if (!freshRows.length) return;
    const freshSticky = freshRows[0];

    if (freshSticky.last_post_message_id) {
      const removedPreviousSticky = await removeStickyPost(message.channel, freshSticky.last_post_message_id);
      if (!removedPreviousSticky) return;
    }

    const components = freshSticky.button_label && freshSticky.button_url
      ? [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: freshSticky.button_label.slice(0, 80),
            url: freshSticky.button_url.slice(0, 512)
          }]
        }]
      : [];

    const payload = freshSticky.is_embed
      ? {
          embeds: [(() => {
            const embed = new EmbedBuilder()
              .setDescription(freshSticky.content)
              .setColor(0x5865F2);
            if (freshSticky.embed_footer_text) {
              embed.setFooter({ text: freshSticky.embed_footer_text.slice(0, 2048) });
            }
            return embed;
          })()],
          components
        }
      : {
          content: freshSticky.content,
          components,
          allowedMentions: { parse: [] }
        };

    const stickyMessage = await message.channel.send(payload).catch(() => null);
    if (!stickyMessage) return;

    await query(
      `UPDATE sticky_messages
       SET last_post_message_id = ?, last_post_at = ?, updated_at = ?
       WHERE id = ?`,
      [stickyMessage.id, Date.now(), Date.now(), freshSticky.id]
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

async function removeStickyPost(channel, messageId) {
  if (!channel?.isTextBased() || !messageId) return true;

  try {
    const previousMessage = await channel.messages.fetch(messageId);
    await previousMessage.delete();
    return true;
  } catch (error) {
    // Unknown Message means the post is already gone, so we can continue safely.
    if (error?.code === 10008) {
      return true;
    }
    return false;
  }
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  getStickyLimit,
  handleStickyMessage,
  cancelStickySchedule
};
