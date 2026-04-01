const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  startPremiumInstance,
  stopPremiumInstance,
  getInstanceStatus,
  isPremiumAllowedUser,
  hasInstanceForUserGlobal
} = require('../utils/premiumManager');
const { redeemPremiumForGuild, removePremiumForUser } = require('../utils/premiumAccessManager');
const { BOT_OWNER_ID } = require('../utils/constants');

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
        .addStringOption(opt =>
          opt
            .setName('status_one')
            .setDescription('Optional custom premium status #1')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('status_two')
            .setDescription('Optional custom premium status #2 (rotates with #1)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop your running premium instance')
        .addStringOption(opt =>
          opt
            .setName('instance_id')
            .setDescription('Instance ID from /premium status')
            .setRequired(true)
        )
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
      const statuses = getInstanceStatus(interaction.user.id);
      if (!statuses.length) {
        return interaction.reply({
          content: 'ℹ️ You do not have a running premium instance.',
          flags: MessageFlags.Ephemeral
        });
      }

      const summary = statuses
        .map(
          s =>
            `• ID: \`${s.instanceId}\` | **${s.botTag}** in **${s.guildCount}** server(s)${s.statusLine ? ` — status: ${s.statusLine}` : ''}`
        )
        .join('\n');

      return interaction.reply({
        content: `✅ You have **${statuses.length}** running premium instance(s):\n${summary}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'stop') {
      const instanceId = interaction.options.getString('instance_id', true).trim();
      const stopped = await stopPremiumInstance(interaction.user.id, { instanceId });
      return interaction.reply({
        content: stopped
          ? `✅ Premium instance \`${instanceId}\` was stopped.`
          : `ℹ️ No running premium instance found for ID \`${instanceId}\`.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const hasGlobalInstance = await hasInstanceForUserGlobal(interaction.client, interaction.user.id);
      if (hasGlobalInstance && interaction.user.id !== BOT_OWNER_ID) {
        return interaction.editReply('❌ You already have an active premium bot instance.');
      }

      const token = interaction.options.getString('token', true).trim();
      const statusOne = interaction.options.getString('status_one')?.trim() || null;
      const statusTwo = interaction.options.getString('status_two')?.trim() || null;
      const created = await startPremiumInstance(interaction.client, interaction.user.id, token, {
        customStatuses: [statusOne, statusTwo].filter(Boolean)
      });
      const statusText = created.statusLine ? ` Custom status: ${created.statusLine}.` : '';

      return interaction.editReply(
        `✅ Premium instance started as **${created.botTag}** in **${created.guildCount}** server(s).${statusText} This will auto-restore after restart.`
      );
    } catch (error) {
      console.error('❌ premium start failed:', error);
      return interaction.editReply(`❌ Failed to start premium instance: ${error.message}`);
    }
  }
};
