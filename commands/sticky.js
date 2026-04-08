const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { DEFAULT_COOLDOWN_MS, cancelStickySchedule } = require('../utils/stickyManager');
const { getPremiumLimit } = require('../utils/premiumPerks');
const { logGuildEvent, LOG_EVENT_KEYS } = require('../utils/guildLogger');

// Disallow mention syntaxes for plain-text sticky messages so they stay non-pinging.
const DISALLOWED_MENTION_PATTERN = /(@everyone|@here|<@!?\d+>|<@&\d+>|(^|\s)@[^\s@]+)/i;
const PERMISSION_LABELS = {
  [PermissionFlagsBits.ViewChannel]: 'View Channel',
  [PermissionFlagsBits.SendMessages]: 'Send Messages',
  [PermissionFlagsBits.EmbedLinks]: 'Embed Links'
};

function getMissingBotPermissionsForChannel(channel, me, requiredPermissions) {
  const permissions = channel.permissionsFor(me);
  if (!permissions) {
    return requiredPermissions;
  }

  return requiredPermissions.filter(permission => !permissions.has(permission));
}

function formatPermissionList(permissionBits) {
  return permissionBits.map(permission => PERMISSION_LABELS[permission] || `Permission ${permission}`).join(', ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Create and manage sticky messages')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create or replace a sticky message in a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for the sticky message')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Text to keep pinned as sticky')
            .setRequired(true)
            .setMaxLength(1800)
        )
        .addIntegerOption(option =>
          option
            .setName('cooldown_seconds')
            .setDescription('Minimum delay between sticky reposts (2-30 seconds)')
            .setMinValue(2)
            .setMaxValue(30)
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('embed')
            .setDescription('Post the sticky as an embed instead of plain text')
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('button_label')
            .setDescription('Optional link button label for the sticky message')
            .setRequired(false)
            .setMaxLength(80)
        )
        .addStringOption(option =>
          option
            .setName('button_url')
            .setDescription('Optional link button URL (https://...)')
            .setRequired(false)
            .setMaxLength(512)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove sticky message from a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to remove sticky from')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List sticky messages configured in this server')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const channel = interaction.options.getChannel('channel', true);
      const content = interaction.options.getString('message', true).trim();
      const cooldownSeconds = interaction.options.getInteger('cooldown_seconds') || Math.round(DEFAULT_COOLDOWN_MS / 1000);
      const cooldownMs = cooldownSeconds * 1000;
      const isEmbed = interaction.options.getBoolean('embed') ?? false;
      const buttonLabel = interaction.options.getString('button_label')?.trim() || null;
      const buttonUrl = interaction.options.getString('button_url')?.trim() || null;
      let embedFooter = null;
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        ...(isEmbed ? [PermissionFlagsBits.EmbedLinks] : [])
      ];
      const missingPermissions = getMissingBotPermissionsForChannel(channel, interaction.guild.members.me || interaction.client.user, requiredPermissions);

      if (missingPermissions.length) {
        return interaction.reply({
          content: `❌ I can't post sticky messages in ${channel}. Missing: ${formatPermissionList(missingPermissions)}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if ((buttonLabel && !buttonUrl) || (!buttonLabel && buttonUrl)) {
        return interaction.reply({
          content: '❌ You must provide both `button_label` and `button_url` (or neither).',
          flags: MessageFlags.Ephemeral
        });
      }

      if (buttonUrl && !/^https?:\/\/\S+$/i.test(buttonUrl)) {
        return interaction.reply({
          content: '❌ Button URL must start with `http://` or `https://`.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Keep plain-text sticky messages non-pinging, but allow mentions in embed mode.
      if (!isEmbed && DISALLOWED_MENTION_PATTERN.test(content)) {
        return interaction.reply({
          content: '❌ Plain-text sticky messages cannot contain mentions (for example: @everyone, @here, or @username). Use embed mode if you need mentions in the sticky text.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (isEmbed) {
        const promptCustomId = `sticky_footer_prompt:${interaction.id}`;
        const promptRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${promptCustomId}:yes`)
            .setLabel('Yes, add footer')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`${promptCustomId}:no`)
            .setLabel('No footer')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
          content: 'Would you like to add an embed footer to this sticky message?',
          components: [promptRow],
          flags: MessageFlags.Ephemeral
        });

        const promptMessage = await interaction.fetchReply().catch(() => null);
        if (!promptMessage) return;

        const buttonChoice = await promptMessage.awaitMessageComponent({
          time: 300000,
          filter: component => component.user.id === interaction.user.id && component.customId.startsWith(promptCustomId)
        }).catch(() => null);

        if (!buttonChoice) {
          await interaction.editReply({
            content: '⏱️ Footer prompt expired after 5 minutes. Please run `/sticky create` again.',
            components: []
          }).catch(() => null);
          return;
        }

        if (buttonChoice.customId.endsWith(':yes')) {
          const modalId = `sticky_footer_modal:${interaction.id}`;
          const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle('Sticky Embed Footer');
          const footerInput = new TextInputBuilder()
            .setCustomId('footer_text')
            .setLabel('Embed footer text')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2048);
          modal.addComponents(new ActionRowBuilder().addComponents(footerInput));
          await buttonChoice.showModal(modal);

          const modalSubmit = await buttonChoice.awaitModalSubmit({
            time: 300000,
            filter: submit => submit.customId === modalId && submit.user.id === interaction.user.id
          }).catch(() => null);

          if (!modalSubmit) {
            await interaction.editReply({
              content: '⏱️ Footer form expired after 5 minutes. Please run `/sticky create` again.',
              components: []
            }).catch(() => null);
            return;
          }

          embedFooter = modalSubmit.fields.getTextInputValue('footer_text').trim() || null;
          await modalSubmit.deferUpdate().catch(() => null);
        } else {
          await buttonChoice.update({ content: 'No footer selected. Creating sticky message…', components: [] }).catch(() => null);
        }
      }

      const limit = await getPremiumLimit(interaction.client, interaction.guildId, 5, 10);

      const currentRows = await query(
        `SELECT id, channel_id
         FROM sticky_messages
         WHERE guild_id = ?`,
        [interaction.guildId]
      );

      const existingForChannel = currentRows.find(row => row.channel_id === channel.id);

      if (!existingForChannel && currentRows.length >= limit) {
        return interaction.reply({
          content: `❌ This bot can only have ${limit} sticky messages in a server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `INSERT INTO sticky_messages
         (guild_id, channel_id, content, is_embed, embed_footer_text, button_label, button_url, enabled, cooldown_ms, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           content = VALUES(content),
           is_embed = VALUES(is_embed),
           embed_footer_text = VALUES(embed_footer_text),
           button_label = VALUES(button_label),
           button_url = VALUES(button_url),
           enabled = 1,
           cooldown_ms = VALUES(cooldown_ms),
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, content, isEmbed ? 1 : 0, embedFooter, buttonLabel, buttonUrl, cooldownMs, interaction.user.id, Date.now()]
      );

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: 'Sticky Updated',
        description: `${interaction.user} updated sticky config for <#${channel.id}>.`,
        fields: [
          { name: 'Mode', value: isEmbed ? 'Embed' : 'Text', inline: true },
          { name: 'Footer', value: embedFooter ? 'Configured' : 'None', inline: true },
          { name: 'Link Button', value: buttonLabel && buttonUrl ? `[${buttonLabel}](${buttonUrl})` : 'None', inline: false }
        ]
      }).catch(() => null);

      const responsePayload = {
        content: `✅ Sticky message saved for ${channel} with a ${cooldownSeconds}s cooldown (${isEmbed ? 'embed' : 'text'} mode).`,
        components: [],
        flags: MessageFlags.Ephemeral
      };
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply(responsePayload);
      }
      return interaction.reply(responsePayload);
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel', true);

      const rows = await query(
        `SELECT last_post_message_id
         FROM sticky_messages
         WHERE guild_id = ? AND channel_id = ?
         LIMIT 1`,
        [interaction.guildId, channel.id]
      );

      await query(
        `DELETE FROM sticky_messages
         WHERE guild_id = ? AND channel_id = ?`,
        [interaction.guildId, channel.id]
      );
      cancelStickySchedule(channel.id);

      const lastPostMessageId = rows[0]?.last_post_message_id;
      if (lastPostMessageId && channel.isTextBased()) {
        await channel.messages.delete(lastPostMessageId).catch(() => null);
      }

      return interaction.reply({
        content: `✅ Removed sticky message for ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rows = await query(
      `SELECT channel_id, cooldown_ms, is_embed, updated_at
       FROM sticky_messages
       WHERE guild_id = ?
       ORDER BY updated_at DESC`,
      [interaction.guildId]
    );

    if (!rows.length) {
      return interaction.reply({
        content: 'No sticky messages configured in this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const limit = await getPremiumLimit(interaction.client, interaction.guildId, 5, 10);
    const body = rows.map((row, index) => {
      const cooldownSeconds = Math.round((Number(row.cooldown_ms) || DEFAULT_COOLDOWN_MS) / 1000);
      return `${index + 1}. <#${row.channel_id}> • cooldown: **${cooldownSeconds}s** • mode: **${row.is_embed ? 'embed' : 'text'}**`;
    }).join('\n');

    return interaction.reply({
      content: `📌 Sticky messages (${rows.length}/${limit})\n${body}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
