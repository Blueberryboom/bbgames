const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { DEFAULT_COOLDOWN_MS, cancelStickySchedule } = require('../utils/stickyManager');
const { getPremiumLimit } = require('../utils/premiumPerks');

// Disallow mention syntaxes to keep sticky messages from pinging users/roles/everyone.
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

      // Reject sticky content containing possible mention tokens so sticky posts stay non-pinging.
      if (DISALLOWED_MENTION_PATTERN.test(content)) {
        return interaction.reply({
          content: '❌ Sticky messages cannot contain mentions (for example: @everyone, @here, or @username).',
          flags: MessageFlags.Ephemeral
        });
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
         (guild_id, channel_id, content, is_embed, enabled, cooldown_ms, updated_by, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           content = VALUES(content),
           is_embed = VALUES(is_embed),
           enabled = 1,
           cooldown_ms = VALUES(cooldown_ms),
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, content, isEmbed ? 1 : 0, cooldownMs, interaction.user.id, Date.now()]
      );

      return interaction.reply({
        content: `✅ Sticky message saved for ${channel} with a ${cooldownSeconds}s cooldown (${isEmbed ? 'embed' : 'text'} mode).`,
        flags: MessageFlags.Ephemeral
      });
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
