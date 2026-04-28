const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTopFeatureLeaderboard } = require('../utils/featureLeaderboard');
const { query } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('features_leaderboard')
    .setDescription('Show BBGames most-used features across servers'),

  async execute(interaction) {
    try {
      const popularFeatures = await getTopFeatureLeaderboard(query, 10);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🏆 BBGames Feature Leaderboard')
        .setDescription('Most-used BBGames features across all servers using this bot.')
        .addFields({
          name: 'Top 10 most popular features',
          value: popularFeatures.map(([name, total], idx) => `**${idx + 1}.** ${name} - ${total} servers`).join('\n') || 'No usage data yet.'
        })
        .setFooter({ text: 'Tip: This matches the feature ranking shown when BBGames is added to a new server.' });

      return interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('⚠️ /features_leaderboard failed:', error);
      return interaction.reply({
        content: '⚠️ Failed to load the feature leaderboard. Please try again.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
