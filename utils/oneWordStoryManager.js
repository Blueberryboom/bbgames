const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');
const { trackAchievementEvent } = require('./achievementManager');

const pendingTimers = new Map();
const DEFAULT_WORD_DELAY_SECONDS = 5;
const MIN_WORD_DELAY_SECONDS = 1;
const MAX_WORD_DELAY_SECONDS = 30;
const MAX_WORD_LENGTH = 12;
const CHECK_EMOJI = '✅';

function getTimerKey(guildId, messageId) {
  return `${guildId}:${messageId}`;
}

function clearPendingTimer(guildId, messageId) {
  const key = getTimerKey(guildId, messageId);
  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
}

function clearGuildOneWordStoryState(guildId) {
  if (!guildId) return;

  for (const [key, timer] of pendingTimers.entries()) {
    if (!key.startsWith(`${guildId}:`)) continue;
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
}

function isSingleValidWord(raw) {
  if (!raw) return false;

  const word = raw.trim();
  if (!word) return false;
  if (/\s/.test(word)) return false;
  if (word.length > MAX_WORD_LENGTH) return false;

  // Keep words strict to avoid cheat formats (underscores, symbols, numbers).
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word);
}

async function getStoryConfig(guildId) {
  const rows = await query(
    `SELECT guild_id, channel_id, story_text, word_count, last_user_id, process_delay_seconds
     FROM one_word_story_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );

  return rows[0] || null;
}

async function resetStory(guildId) {
  await query(
    `INSERT INTO one_word_story_settings
     (guild_id, channel_id, story_text, word_count, last_user_id, updated_at)
     VALUES (?, NULL, '', 0, NULL, ?)
     ON DUPLICATE KEY UPDATE
       story_text = '',
       word_count = 0,
       last_user_id = NULL,
       updated_at = VALUES(updated_at)`,
    [guildId, Date.now()]
  );
}

async function queueOneWordStoryMessage(message) {
  if (!message.guild || message.author.bot || !message.channel?.isTextBased()) return;

  const config = await getStoryConfig(message.guildId);
  if (!config || !config.channel_id || config.channel_id !== message.channel.id) return;

  const key = getTimerKey(message.guildId, message.id);
    const configuredSeconds = Math.min(MAX_WORD_DELAY_SECONDS, Math.max(MIN_WORD_DELAY_SECONDS, Number(config.process_delay_seconds || DEFAULT_WORD_DELAY_SECONDS)));

  const timer = setTimeout(async () => {
    pendingTimers.delete(key);
    await processQueuedMessage(message).catch(error => {
      console.error('⚠️ One-word story processing failed:', error);
    });
  }, configuredSeconds * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  pendingTimers.set(key, timer);
}

async function processQueuedMessage(message) {
  const content = message.content?.trim();
  if (!isSingleValidWord(content)) return;

  const rows = await query(
    `SELECT guild_id, channel_id, story_text, word_count, last_user_id, process_delay_seconds
     FROM one_word_story_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [message.guildId]
  );

  const config = rows[0];
  if (!config || config.channel_id !== message.channel.id) return;

  if (config.last_user_id && config.last_user_id === message.author.id) return;

  const currentText = (config.story_text || '').trim();
  const nextWord = content;
  const nextText = currentText ? `${currentText} ${nextWord}` : nextWord;
  const nextCount = Number(config.word_count || 0) + 1;

  await query(
    `UPDATE one_word_story_settings
     SET story_text = ?, word_count = ?, last_user_id = ?, updated_at = ?
     WHERE guild_id = ?`,
    [nextText, nextCount, message.author.id, Date.now(), message.guildId]
  );

  await message.react(CHECK_EMOJI).catch(() => null);
  await trackAchievementEvent({
    userId: message.author.id,
    event: 'one_word_story_word',
    context: {
      guildId: message.guildId,
      channelId: message.channel.id,
      channel: message.channel,
      userMention: `${message.author}`
    }
  });

  await query(
    `INSERT INTO one_word_story_contributions
     (guild_id, channel_id, message_id, user_id, stars, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       stars = VALUES(stars),
       created_at = VALUES(created_at)`,
    [message.guildId, message.channel.id, message.id, message.author.id, Date.now()]
  );

  if (nextCount % 25 === 0 && nextCount < 100) {
    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`One Word Story • ${nextCount}/100 words`)
          .setDescription(nextText)
      ]
    }).catch(() => null);
  }

  if (nextCount >= 100) {
    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('One Word Story • Final (100 words)')
          .setDescription(nextText)
      ]
    }).catch(() => null);

    await query(
      `UPDATE one_word_story_settings
       SET story_text = '', word_count = 0, last_user_id = NULL, updated_at = ?
       WHERE guild_id = ?`,
      [Date.now(), message.guildId]
    );
  }
}

async function updateContributionStarCount({ guildId, messageId, channelId, delta }) {
  if (!guildId || !messageId || !delta) return;

  if (!channelId) {
    const rows = await query(
      `SELECT channel_id
       FROM one_word_story_contributions
       WHERE guild_id = ? AND message_id = ?
       LIMIT 1`,
      [guildId, messageId]
    );
    channelId = rows[0]?.channel_id || null;
  }

  if (!channelId) return;

  const config = await getStoryConfig(guildId);
  if (!config?.channel_id || config.channel_id !== channelId) return;

  await query(
    `UPDATE one_word_story_contributions
     SET stars = GREATEST(1, stars + ?)
     WHERE guild_id = ? AND message_id = ?`,
    [delta, guildId, messageId]
  );
}

module.exports = {
  DEFAULT_WORD_DELAY_SECONDS,
  MIN_WORD_DELAY_SECONDS,
  MAX_WORD_DELAY_SECONDS,
  getStoryConfig,
  resetStory,
  queueOneWordStoryMessage,
  updateContributionStarCount,
  clearPendingTimer,
  clearGuildOneWordStoryState
};
