const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { EVENT_TYPES, DEFAULT_MESSAGES, renderMessage } = require('../utils/memberEventMessages');
const { LOG_EVENT_KEYS, logGuildEvent } = require('../utils/guildLogger');

function validateButton(buttonLabel, buttonUrl) {
  if ((buttonLabel && !buttonUrl) || (!buttonLabel && buttonUrl)) {
    return '⚠️ To add a link button, provide both **Link button name** and **Link button** URL.';
  }
  if (!buttonUrl) return null;
  let parsed;
  try {
    parsed = new URL(buttonUrl);
  } catch {
    return '⚠️ Link button must be a valid URL.';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return '⚠️ Link button URL must start with http:// or https://.';
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boostmsg')
    .setDescription('Configure boost messages')
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure boost messages for this server')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where boost messages are sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Custom boost message (supports [$usermention], [$membercount], [$guildname])')
            .setMaxLength(1800)
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('link_button_name')
            .setDescription('Optional button text for a link button')
            .setRequired(false)
            .setMaxLength(80)
        )
        .addStringOption(option =>
          option
            .setName('link_button')
            .setDescription('Optional URL for the boost link button')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable boost messages for this server')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'disable') {
      await query(
        `DELETE FROM member_event_messages
         WHERE guild_id = ? AND event_type = ?`,
        [interaction.guildId, EVENT_TYPES.boost]
      );

      await logGuildEvent(
        interaction.client,
        interaction.guildId,
        LOG_EVENT_KEYS.modules_disabled,
        `🧩 **Module disabled:** Boost messages were disabled by <@${interaction.user.id}>.`
      );

      return interaction.reply({
        content: '✅ Boost messages disabled for this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const channel = interaction.options.getChannel('channel', true);
    const messageTemplate = interaction.options.getString('message') || DEFAULT_MESSAGES[EVENT_TYPES.boost];
    const buttonLabel = interaction.options.getString('link_button_name');
    const buttonUrl = interaction.options.getString('link_button');

    const buttonValidationError = validateButton(buttonLabel, buttonUrl);
    if (buttonValidationError) {
      return interaction.reply({ content: buttonValidationError, flags: MessageFlags.Ephemeral });
    }

    await query(
      `REPLACE INTO member_event_messages
       (guild_id, event_type, channel_id, message_template, button_label, button_url, enabled, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        interaction.guildId,
        EVENT_TYPES.boost,
        channel.id,
        messageTemplate,
        buttonLabel || null,
        buttonUrl || null,
        interaction.user.id,
        Date.now()
      ]
    );

    await logGuildEvent(
      interaction.client,
      interaction.guildId,
      LOG_EVENT_KEYS.modules_enabled,
      `🧩 **Module configured:** Boost messages set by <@${interaction.user.id}> in <#${channel.id}>.`
    );

    await logGuildEvent(
      interaction.client,
      interaction.guildId,
      LOG_EVENT_KEYS.bot_setting_changes,
      `⚙️ **Setting changed:** /boostmsg config used by <@${interaction.user.id}>.`
    );

    return interaction.reply({
      content:
        `✅ Boost messages configured in <#${channel.id}>.\n` +
        `Preview: ${renderMessage(messageTemplate, interaction.user, interaction.guild)}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  },

  requiredBotPermissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages
  ]
};
