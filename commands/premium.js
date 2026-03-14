const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  startPremiumInstance,
  stopPremiumInstance,
  getInstanceStatus,
  isPremiumAllowedUser,
  hasInstanceForUserGlobal
} = require('../utils/premiumManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage your premium custom bot token (DM only)')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start your premium instance with your bot token')
        .addStringOption(opt =>
          opt
            .setName('token')
            .setDescription('Your custom bot token')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop your running premium instance')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check your premium instance status')
    ),

  async execute(interaction) {
    if (interaction.inGuild()) {
      return interaction.reply({
        content: '❌ This command only works in DMs.',
        flags: MessageFlags.Ephemeral
      });
    }

    const allowed = await isPremiumAllowedUser(interaction.user.id);
    if (!allowed) {
      return interaction.reply({
        content: '❌ You are not allowed to use premium instances.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const status = getInstanceStatus(interaction.user.id);
      if (!status) {
        return interaction.reply({
          content: 'ℹ️ You do not have a running premium instance.',
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.reply({
        content: `✅ Premium instance running as **${status.botTag}** in **${status.guildCount}** server(s).`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'stop') {
      const stopped = await stopPremiumInstance(interaction.user.id);
      return interaction.reply({
        content: stopped
          ? '✅ Your premium instance was stopped.'
          : 'ℹ️ You do not have a running premium instance.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const hasGlobalInstance = await hasInstanceForUserGlobal(interaction.client, interaction.user.id);
      if (hasGlobalInstance) {
        return interaction.editReply('❌ You already have an active premium bot instance.');
      }

      const token = interaction.options.getString('token', true).trim();
      const created = await startPremiumInstance(interaction.client, interaction.user.id, token);

      return interaction.editReply(
        `✅ Premium instance started as **${created.botTag}** in **${created.guildCount}** server(s). This will auto-restore after restart.`
      );
    } catch (error) {
      console.error('❌ premium start failed:', error);
      return interaction.editReply(`❌ Failed to start premium instance: ${error.message}`);
    }
  }
};
