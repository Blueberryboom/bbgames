const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getAchievementRows, buildAchievementEmbed } = require('../utils/achievementManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('View your global BBGames achievements')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to view')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const rows = await getAchievementRows(targetUser.id);
      const embed = buildAchievementEmbed(targetUser, rows);
      const payload = { embeds: [embed] };
      if (targetUser.id !== interaction.user.id) {
        payload.flags = MessageFlags.Ephemeral;
      }

      await interaction.reply(payload);
    } catch (error) {
      console.error('⚠️ /achievements failed:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '⚠️ Failed to load achievements. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};
