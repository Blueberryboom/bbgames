const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { query } = require('../database');
const { xpForNextLevel, progressBar } = require('../utils/levelingSystem');
const { guildHasPremiumPerks } = require('../utils/premiumPerks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('View your level card or a leaderboard')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to check')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('leaderboard')
        .setDescription('Show leaderboard instead of a user card')
        .setRequired(false)
        .addChoices(
          { name: '7 day', value: '7d' },
          { name: 'month', value: 'month' },
          { name: 'all time', value: 'all' }
        )
    ),

  async execute(interaction) {
    try {
      const boardType = interaction.options.getString('leaderboard');
      if (boardType) {
        return showLeaderboard(interaction, boardType);
      }


      const premiumEnabled = await guildHasPremiumPerks(interaction.client, interaction.guildId);
      if (!premiumEnabled) {
        const rewardRows = await query(
          `SELECT COUNT(*) AS total
           FROM leveling_role_rewards
           WHERE guild_id = ?`,
          [interaction.guildId]
        );

        if (Number(rewardRows[0]?.total || 0) > 15) {
          return interaction.reply({
            content: '⚠️ Leveling is temporarily disabled in this server because more than 15 level reward roles are configured without premium perks. Reduce it to 15 or less.',
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const target = interaction.options.getUser('user') || interaction.user;
      const rows = await query(
        `SELECT xp, level
         FROM leveling_users
         WHERE guild_id = ? AND user_id = ?
         LIMIT 1`,
        [interaction.guildId, target.id]
      );

      const xp = Number(rows[0]?.xp || 0);
      const level = Number(rows[0]?.level || 0);
      const goal = xpForNextLevel(level);
      const currentInLevel = xp;

      const card = new EmbedBuilder()
        .setColor(0x4F8BFF)
        .setAuthor({ name: `${target.username}'s Level` })
        .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(`Level ${level}\n\`${progressBar(currentInLevel, goal)}\`\n${currentInLevel}/${goal} XP`)
        .setFooter({ text: 'Earn XP by chatting in allowed channels.' });

      return interaction.reply({ embeds: [card] });
    } catch (error) {
      console.error('❌ Level command failed:', error);
      return interaction.reply({
        content: '❌ Could not fetch level data right now.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

async function showLeaderboard(interaction, boardType) {
  let where = '';
  let params = [interaction.guildId];

  if (boardType === '7d') {
    where = 'AND created_at >= ?';
    params.push(Date.now() - (7 * 24 * 60 * 60 * 1000));
  } else if (boardType === 'month') {
    where = 'AND created_at >= ?';
    params.push(Date.now() - (30 * 24 * 60 * 60 * 1000));
  }

  const rows = await query(
    `SELECT user_id, COALESCE(SUM(xp_gained), 0) AS total_xp
     FROM leveling_xp_events
     WHERE guild_id = ? ${where}
     GROUP BY user_id
     ORDER BY total_xp DESC
     LIMIT 10`,
    params
  );

  if (!rows.length) {
    return interaction.reply({ content: 'No leaderboard data yet.' });
  }

  const lines = rows.map((row, index) => `#${index + 1} <@${row.user_id}> - ${Number(row.total_xp)} XP`);
  const title = boardType === 'all'
    ? 'Level Leaderboard • All Time'
    : boardType === 'month'
      ? 'Level Leaderboard • 30 Days'
      : 'Level Leaderboard • 7 Days';

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(title)
    .setDescription(lines.join('\n'));

  return interaction.reply({ embeds: [embed] });
}
