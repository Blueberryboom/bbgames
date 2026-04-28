const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const ACHIEVEMENTS = [
  {
    key: 'forever_afk',
    tier: 'Platinum',
    icon: '🧀',
    name: 'Forever AFK',
    description: 'Be AFK for 48 hours!!',
    target: 1,
    event: 'afk_48h'
  },
  {
    key: 'forever_counting',
    tier: 'Gold',
    icon: '🥇',
    name: 'Forever Counting',
    description: 'Count 500 times',
    target: 500,
    event: 'count_success'
  },
  {
    key: 'tictactoe_pro',
    tier: 'Gold',
    icon: '🥇',
    name: 'TicTacToe Pro',
    description: 'Win at TicTacToe 10 times',
    target: 10,
    event: 'tictactoe_win'
  },
  {
    key: 'uhhh_how_many',
    tier: 'Silver',
    icon: '🥈',
    name: 'Uhhh how many',
    description: 'Land on tails 20 times in coin flips',
    target: 20,
    event: 'coinflip_tails'
  },
  {
    key: 'owner_invite',
    tier: 'Silver',
    icon: '🥈',
    name: 'Server Owner',
    description: 'Add BBGames to a server that you own',
    target: 1,
    event: 'bot_added_owner_server'
  },
  {
    key: 'fifty_word_story',
    tier: 'Silver',
    icon: '🥈',
    name: '50 Word Story',
    description: 'Contribute 50 words to a One Word Story',
    target: 50,
    event: 'one_word_story_word'
  },
  {
    key: 'quitting_discord',
    tier: 'Bronze',
    icon: '🥉',
    name: 'Quitting Discord',
    description: 'Go AFK for one hour',
    target: 1,
    event: 'afk_1h'
  },
  {
    key: 'how_many_tags',
    tier: 'Bronze',
    icon: '🥉',
    name: 'HOW MANY TAGS?!',
    description: 'Send 25 tags',
    target: 25,
    event: 'tag_send'
  },
  {
    key: 'rock_paper_winner',
    tier: 'Bronze',
    icon: '🥉',
    name: 'Rock Paper Winner',
    description: 'Win 5 games of rock paper scissors',
    target: 5,
    event: 'rps_win'
  },
  {
    key: 'giveaway_big_win',
    tier: 'Bronze',
    icon: '🥉',
    name: 'Lucky Winner',
    description: 'Win a giveaway with more than 5 entrants',
    target: 1,
    event: 'giveaway_win_5plus'
  }
];

const ACHIEVEMENTS_BY_EVENT = ACHIEVEMENTS.reduce((acc, achievement) => {
  if (!acc[achievement.event]) acc[achievement.event] = [];
  acc[achievement.event].push(achievement);
  return acc;
}, {});

function getProgressLabel(progress, target) {
  const safeProgress = Math.max(0, Number(progress) || 0);
  return target === 1 ? (safeProgress >= 1 ? 'Done' : 'Not started') : `${Math.min(safeProgress, target)}/${target}`;
}

async function loadAchievementState(userId) {
  const rows = await query(
    `SELECT achievement_key, progress, unlocked_at
     FROM achievements_progress
     WHERE user_id = ?`,
    [userId]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.achievement_key, {
      progress: Number(row.progress) || 0,
      unlockedAt: row.unlocked_at ? Number(row.unlocked_at) : null
    });
  }

  return map;
}

async function getAchievementRows(userId) {
  const progressMap = await loadAchievementState(userId);

  return ACHIEVEMENTS.map(achievement => {
    const state = progressMap.get(achievement.key);
    const progress = state?.progress || 0;
    const unlocked = Boolean(state?.unlockedAt);

    return {
      ...achievement,
      progress,
      unlocked,
      progressLabel: getProgressLabel(progress, achievement.target)
    };
  });
}

async function trackAchievementEvent({ userId, event, amount = 1, context = {} }) {
  if (!userId || !event) return [];

  const achievements = ACHIEVEMENTS_BY_EVENT[event] || [];
  if (!achievements.length) return [];

  const safeAmount = Math.max(0, Number(amount) || 0);
  if (!safeAmount) return [];

  const unlockedNow = [];
  const now = Date.now();

  for (const achievement of achievements) {
    const existingRows = await query(
      `SELECT progress, unlocked_at
       FROM achievements_progress
       WHERE user_id = ? AND achievement_key = ?
       LIMIT 1`,
      [userId, achievement.key]
    );

    const existing = existingRows[0] || null;
    const existingProgress = Number(existing?.progress) || 0;
    const alreadyUnlocked = Boolean(existing?.unlocked_at);

    const nextProgress = Math.max(existingProgress, safeAmount > 1 && achievement.target === 1 ? 1 : existingProgress + safeAmount);
    const shouldUnlock = !alreadyUnlocked && nextProgress >= achievement.target;
    const unlockedAt = shouldUnlock ? now : (existing?.unlocked_at || null);

    await query(
      `INSERT INTO achievements_progress
       (user_id, achievement_key, progress, unlocked_at, unlocked_guild_id, unlocked_channel_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         progress = VALUES(progress),
         unlocked_at = COALESCE(achievements_progress.unlocked_at, VALUES(unlocked_at)),
         unlocked_guild_id = COALESCE(achievements_progress.unlocked_guild_id, VALUES(unlocked_guild_id)),
         unlocked_channel_id = COALESCE(achievements_progress.unlocked_channel_id, VALUES(unlocked_channel_id)),
         updated_at = VALUES(updated_at)`,
      [
        userId,
        achievement.key,
        nextProgress,
        unlockedAt,
        shouldUnlock ? (context.guildId || null) : null,
        shouldUnlock ? (context.channelId || null) : null,
        now
      ]
    );

    if (shouldUnlock) {
      unlockedNow.push(achievement);
    }
  }

  if (unlockedNow.length && context.channel?.isTextBased?.()) {
    for (const achievement of unlockedNow) {
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎉 Achievement unlocked!')
        .setDescription(
          `${context.userMention || `<@${userId}>`} just earned **${achievement.name}** (${achievement.tier}).\n${achievement.description}`
        );

      const notice = await context.channel.send({ embeds: [embed] }).catch(() => null);
      if (notice) {
        setTimeout(() => {
          notice.delete().catch(() => null);
        }, 10_000);
      }
    }
  }

  return unlockedNow;
}

function buildAchievementEmbed(user, rows) {
  const tierOrder = ['Platinum', 'Gold', 'Silver', 'Bronze'];

  const grouped = tierOrder.map(tier => {
    const tierRows = rows.filter(row => row.tier === tier);
    if (!tierRows.length) return null;

    const lines = tierRows.map(row => {
      const status = row.unlocked ? '✅' : '⚠️';
      return `${status} ${row.icon} **${row.name}** - ${row.description} *(Progress: ${row.progressLabel})*`;
    });

    return {
      name: `${tier}`,
      value: lines.join('\n')
    };
  }).filter(Boolean);

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🏆 ${user.username}'s Achievements`)
    .addFields(grouped)
    .setTimestamp();
}

module.exports = {
  ACHIEVEMENTS,
  getAchievementRows,
  trackAchievementEvent,
  buildAchievementEmbed
};
