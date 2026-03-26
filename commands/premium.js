const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  startPremiumInstance,
  stopPremiumInstance,
  getInstanceStatus,
  isPremiumAllowedUser,
  hasInstanceForUserGlobal
} = require('../utils/premiumManager');
const { redeemPremiumForGuild, removePremiumForUser } = require('../utils/premiumAccessManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage premium features')
    .addSubcommand(sub =>
      sub
        .setName('redeem')
        .setDescription('Redeem server premium perks (no custom bot) for this server')
        .addStringOption(o =>
          o
            .setName('code')
            .setDescription('Optional premium code from the owner panel')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove your redeemed server premium perks immediately')
    )
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
    const sub = interaction.options.getSubcommand();

    if (sub === 'redeem') {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '❌ `/premium redeem` must be used in the server where you want perks enabled.',
          flags: MessageFlags.Ephemeral
        });
      }

      const code = interaction.options.getString('code');

      try {
        const redeemed = await redeemPremiumForGuild(interaction.client, interaction.guildId, interaction.user.id, code);
        const expiryText = redeemed.expiresAt ? ` Expires <t:${Math.floor(redeemed.expiresAt / 1000)}:R>.` : '';
        const modeText = redeemed.sourceType === 'code' ? 'premium code' : 'role-based premium';

        return interaction.reply({
          content: `✅ Premium perks enabled for **${redeemed.guildName}** using ${modeText}.${expiryText} This tier includes premium server features but not a custom bot.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        return interaction.reply({
          content: `❌ Could not redeem premium perks: ${error.message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (sub === 'remove') {
      const result = await removePremiumForUser(interaction.user.id);
      return interaction.reply({
        content: result.removed
          ? '✅ Your server premium perks were removed immediately. You can now redeem in a new server.'
          : 'ℹ️ You do not currently have active redeemed server premium perks.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.inGuild()) {
      return interaction.reply({
        content: '❌ `/premium start|stop|status` only works in DMs.',
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
