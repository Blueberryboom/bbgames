const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const pendingTimers = new Map();
const WORD_DELAY_MS = 5000;
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

  // Keep words strict to avoid cheat formats (underscores, symbols, numbers).
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word);
}

async function getStoryConfig(guildId) {
  const rows = await query(
    `SELECT guild_id, channel_id, story_text, word_count, last_user_id
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
  const timer = setTimeout(async () => {
    pendingTimers.delete(key);
    await processQueuedMessage(message).catch(error => {
      console.error('❌ One-word story processing failed:', error);
    });
  }, WORD_DELAY_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  pendingTimers.set(key, timer);
}

async function processQueuedMessage(message) {
  const content = message.content?.trim();
  if (!isSingleValidWord(content)) return;

  const rows = await query(
    `SELECT guild_id, channel_id, story_text, word_count, last_user_id
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

module.exports = {
  WORD_DELAY_MS,
  getStoryConfig,
  resetStory,
  queueOneWordStoryMessage,
  clearPendingTimer,
  clearGuildOneWordStoryState
};
