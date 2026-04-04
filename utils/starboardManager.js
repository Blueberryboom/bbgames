const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const configCache = new Map();
const bannedCache = new Map();
const CACHE_TTL_MS = 30_000;

function parseStoredEmoji(stored) {
  if (!stored || typeof stored !== 'string') return { type: 'unicode', value: '⭐' };
  if (stored.startsWith('c:')) return { type: 'custom', value: stored.slice(2) };
  if (stored.startsWith('u:')) return { type: 'unicode', value: stored.slice(2) };
  return { type: 'unicode', value: stored };
}

function normalizeEmojiInput(input) {
  if (!input) return null;
  const raw = input.trim();
  const customMatch = raw.match(/^<a?:\w+:(\d+)>$/);
  if (customMatch) return `c:${customMatch[1]}`;
  if (/^\d{16,20}$/.test(raw)) return `c:${raw}`;
  if (raw.length > 0 && raw.length <= 64) return `u:${raw}`;
  return null;
}

function formatStoredEmoji(stored) {
  const parsed = parseStoredEmoji(stored);
  return parsed.type === 'custom' ? `<:emoji:${parsed.value}>` : parsed.value;
}

function reactionMatchesConfig(reaction, storedEmoji) {
  const parsed = parseStoredEmoji(storedEmoji);
  if (parsed.type === 'custom') return reaction.emoji?.id === parsed.value;
  return reaction.emoji?.id == null && reaction.emoji?.name === parsed.value;
}

function parseHexColor(input) {
  if (!input) return null;
  const cleaned = String(input).trim().replace('#', '');
  if (!/^[A-Fa-f0-9]{6}$/.test(cleaned)) return null;
  return parseInt(cleaned, 16);
}

async function pruneGuildStarboardRows(guildId) {
  await query(
    `DELETE sp FROM starboard_posts sp
     LEFT JOIN starboard_configs sc ON sc.id = sp.config_id
     WHERE sp.guild_id = ? AND sc.id IS NULL`,
    [guildId]
  );
}

async function loadGuildConfigs(guildId) {
  const now = Date.now();
  const cached = configCache.get(guildId);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) return cached.rows;

  await pruneGuildStarboardRows(guildId);

  const rows = await query(
    `SELECT id, guild_id, name, channel_id, reaction_emoji, min_reactions, embed_color
     FROM starboard_configs
     WHERE guild_id = ?
     ORDER BY name ASC`,
    [guildId]
  );

  configCache.set(guildId, { fetchedAt: now, rows });
  return rows;
}

async function loadGuildBans(guildId) {
  const now = Date.now();
  const cached = bannedCache.get(guildId);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) return cached.userIds;

  await pruneGuildStarboardRows(guildId);

  const rows = await query(
    `SELECT user_id
     FROM starboard_banned_users
     WHERE guild_id = ?`,
    [guildId]
  );

  const userIds = new Set(rows.map(row => row.user_id));
  bannedCache.set(guildId, { fetchedAt: now, userIds });
  return userIds;
}

function invalidateGuildCache(guildId) {
  configCache.delete(guildId);
  bannedCache.delete(guildId);
}

function buildStarboardEmbed(message, reactionCount, config) {
  const description = message.content?.trim() || '*No message content.*';
  const color = Number(config.embed_color) || 0xF1C40F;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: message.author?.tag || message.author?.username || 'Unknown User',
      iconURL: message.author?.displayAvatarURL?.({ size: 128 }) || null
    })
    .setDescription(description)
    .setFooter({ text: `#${message.channel?.name || 'unknown-channel'} • ${message.id}` })
    .setTimestamp(message.createdAt || new Date());

  const firstAttachment = message.attachments?.first?.();
  if (firstAttachment?.contentType?.startsWith('image/')) {
    embed.setImage(firstAttachment.url);
  }

  embed.addFields(
    { name: 'Jump', value: `[Go to message](${message.url})`, inline: true },
    { name: 'Reactions', value: String(reactionCount), inline: true }
  );

  return embed;
}

async function upsertStarboardPost({ message, reactionCount, config }) {
  const targetChannel = await message.guild.channels.fetch(config.channel_id).catch(() => null);
  if (!targetChannel?.isTextBased()) return;

  const emojiText = formatStoredEmoji(config.reaction_emoji);
  const content = `${emojiText} **${reactionCount}** | [Jump to message](${message.url})`;
  const embed = buildStarboardEmbed(message, reactionCount, config);

  const existingRows = await query(
    `SELECT starboard_message_id
     FROM starboard_posts
     WHERE guild_id = ? AND config_id = ? AND source_message_id = ?
     LIMIT 1`,
    [message.guildId, config.id, message.id]
  );

  const existingMessageId = existingRows[0]?.starboard_message_id;

  if (existingMessageId) {
    const existingMessage = await targetChannel.messages.fetch(existingMessageId).catch(() => null);
    if (existingMessage) {
      await existingMessage.edit({ content, embeds: [embed] }).catch(() => null);
      await query(
        `UPDATE starboard_posts
         SET last_count = ?, updated_at = ?
         WHERE guild_id = ? AND config_id = ? AND source_message_id = ?`,
        [reactionCount, Date.now(), message.guildId, config.id, message.id]
      );
      return;
    }
  }

  const posted = await targetChannel.send({ content, embeds: [embed] }).catch(() => null);
  if (!posted) return;

  await query(
    `INSERT INTO starboard_posts
     (guild_id, config_id, source_channel_id, source_message_id, starboard_message_id, last_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       starboard_message_id = VALUES(starboard_message_id),
       last_count = VALUES(last_count),
       updated_at = VALUES(updated_at)`,
    [message.guildId, config.id, message.channelId, message.id, posted.id, reactionCount, Date.now()]
  );
}

async function removeStarboardPost(guildId, configId, sourceMessageId) {
  // Keep the DB clean when reactions drop below threshold.
  await query(
    `DELETE FROM starboard_posts
     WHERE guild_id = ? AND config_id = ? AND source_message_id = ?`,
    [guildId, configId, sourceMessageId]
  );
}

async function processStarboardReaction(reaction, user) {
  if (!reaction?.message?.guildId || !user || user.bot) return;

  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

  const message = reaction.message;
  if (!message?.guild || !message.author || message.author.bot) return;

  const configs = await loadGuildConfigs(message.guildId);
  if (!configs.length) return;

  const banned = await loadGuildBans(message.guildId);
  if (banned.has(message.author.id)) return;

  for (const config of configs) {
    if (!reactionMatchesConfig(reaction, config.reaction_emoji)) continue;

    const reactionCount = Number(reaction.count || 0);
    const minReactions = Number(config.min_reactions || 1);

    if (reactionCount < minReactions) {
      await removeStarboardPost(message.guildId, config.id, message.id);
      continue;
    }

    await upsertStarboardPost({ message, reactionCount, config });
  }
}

async function cleanupStarboardSourceMessage(guildId, messageId) {
  if (!guildId || !messageId) return;
  await query(
    `DELETE FROM starboard_posts
     WHERE guild_id = ? AND source_message_id = ?`,
    [guildId, messageId]
  );
}

module.exports = {
  normalizeEmojiInput,
  parseHexColor,
  formatStoredEmoji,
  invalidateGuildCache,
  processStarboardReaction,
  cleanupStarboardSourceMessage
};
