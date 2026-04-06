const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages from this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of recent messages to delete (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('only_human_messages')
        .setDescription('Only delete human (non-bot) messages? (yes/no)')
        .setRequired(false)
    ),

  requiredBotPermissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages
  ],

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '❌ This command can only be used in a server channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({
        content: '❌ You need the **Manage Messages** permission to use `/purge`.',
        flags: MessageFlags.Ephemeral
      });
    }

    const amount = interaction.options.getInteger('amount', true);
    const onlyHumanMessages = interaction.options.getBoolean('only_human_messages') ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fetched = await interaction.channel.messages.fetch({ limit: 100 });

    let candidates = fetched
      .filter(message => !message.pinned)
      .first(amount);

    if (onlyHumanMessages) {
      candidates = candidates.filter(message => !message.author.bot);
    }

    if (!candidates.length) {
      return interaction.editReply('⚠️ No matching messages found to delete.');
    }

    const deleted = await interaction.channel.bulkDelete(candidates, true);
    const requested = candidates.length;
    const deletedCount = deleted.size;
    const skippedCount = requested - deletedCount;

    let result = `✅ Deleted **${deletedCount}** message${deletedCount === 1 ? '' : 's'}.`;

    if (skippedCount > 0) {
      result += ` Skipped **${skippedCount}** message${skippedCount === 1 ? '' : 's'} (likely older than 14 days).`;
    }

    if (onlyHumanMessages) {
      result += ' Filter used: **only human messages**.';
    }

    return interaction.editReply(result);
  }
};
