const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getAfkLeaderboard, formatDuration } = require('../utils/afkManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk_leaderboard')
    .setDescription('Show global leaderboard for AFK stats (all servers)'),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '❌ This command can only be used inside a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      const rows = await getAfkLeaderboard(interaction.guildId, 10);
      if (!rows.length) {
        return interaction.reply('📭 No AFK leaderboard data yet. Only all-server AFKs are tracked here once users return from AFK.');
      }

      const description = rows
        .map((row, index) => `**#${index + 1}** <@${row.user_id}>\n➤ Longest AFK: **${formatDuration(Number(row.longest_afk_ms || 0))}**\n➤ Total AFK: **${formatDuration(Number(row.total_afk_ms || 0))}**\n➤ AFK Sessions: **${Number(row.afk_sessions || 0)}**`)
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('🏆 AFK Leaderboard')
        .setColor(0x5865F2)
        .setDescription(description)
        .setFooter({ text: 'Global AFK only (all servers). Users inactive for 2+ days are excluded automatically.' });

      return interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('❌ /afk_leaderboard failed:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '❌ Failed to load AFK leaderboard.',
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.followUp({
        content: '❌ Failed to load AFK leaderboard.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
