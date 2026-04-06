const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { refreshAutoMessageSchedule } = require('../utils/autoMessageManager');
const { getPremiumLimit } = require('../utils/premiumPerks');

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PERMISSION_LABELS = {
  [PermissionFlagsBits.ViewChannel]: 'View Channel',
  [PermissionFlagsBits.SendMessages]: 'Send Messages'
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
    .setName('automsg')
    .setDescription('Create and manage scheduled automatic messages')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create an automatic message for a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where the message is sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('interval')
            .setDescription('Schedule interval (e.g. 2h 5m, 4m 36s, 2h 5s)')
            .setRequired(true)
            .setMaxLength(30)
        )
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Message content to send')
            .setRequired(true)
            .setMaxLength(1800)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List automatic messages configured in this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a configured automatic message')
        .addIntegerOption(option =>
          option
            .setName('id')
            .setDescription('Auto message ID from /automsg list')
            .setRequired(true)
            .setMinValue(1)
        )
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
      const intervalInput = interaction.options.getString('interval', true);
      const content = interaction.options.getString('message', true).trim();
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ];
      const missingPermissions = getMissingBotPermissionsForChannel(channel, interaction.guild.members.me || interaction.client.user, requiredPermissions);

      if (missingPermissions.length) {
        return interaction.reply({
          content: `❌ I can't send automatic messages in ${channel}. Missing: ${formatPermissionList(missingPermissions)}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const intervalMs = parseDurationMs(intervalInput);
      if (!intervalMs) {
        return interaction.reply({
          content: '❌ Invalid interval format. Use combinations like `2h 5m`, `4m 36s`, or `2h 5s`.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
        return interaction.reply({
          content: '❌ Interval must be between 30 minutes and 24 hours.',
          flags: MessageFlags.Ephemeral
        });
      }

      const currentRows = await query(
        `SELECT id
         FROM auto_messages
         WHERE guild_id = ?`,
        [interaction.guildId]
      );

      const limit = await getPremiumLimit(interaction.client, interaction.guildId, 2, 10);
      if (currentRows.length >= limit) {
        return interaction.reply({
          content: `❌ This bot can only have ${limit} automatic messages in this server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const now = Date.now();
      const nextRunAt = now + intervalMs;

      const result = await query(
        `INSERT INTO auto_messages
         (guild_id, channel_id, content, interval_ms, next_run_at, enabled, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [interaction.guildId, channel.id, content, intervalMs, nextRunAt, interaction.user.id, now]
      );

      const autoMessageId = Number(result.insertId);
      if (autoMessageId) {
        await refreshAutoMessageSchedule(interaction.client, autoMessageId);
      }

      return interaction.reply({
        content: `✅ Auto message #${autoMessageId} created for ${channel} every **${formatDuration(intervalMs)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);

      const rows = await query(
        `SELECT id
         FROM auto_messages
         WHERE guild_id = ? AND id = ?
         LIMIT 1`,
        [interaction.guildId, id]
      );

      if (!rows.length) {
        return interaction.reply({
          content: '❌ Auto message not found for this server.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `DELETE FROM auto_messages
         WHERE guild_id = ? AND id = ?`,
        [interaction.guildId, id]
      );

      await refreshAutoMessageSchedule(interaction.client, id);

      return interaction.reply({
        content: `✅ Removed auto message #${id}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rows = await query(
      `SELECT id, channel_id, interval_ms, next_run_at
       FROM auto_messages
       WHERE guild_id = ?
       ORDER BY id ASC`,
      [interaction.guildId]
    );

    if (!rows.length) {
      return interaction.reply({
        content: 'No automatic messages configured in this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const limit = await getPremiumLimit(interaction.client, interaction.guildId, 2, 10);
    const list = rows.map((row, index) => {
      const remainingMs = Math.max(0, Number(row.next_run_at) - Date.now());
      return `${index + 1}. ID **${row.id}** • <#${row.channel_id}> • every **${formatDuration(Number(row.interval_ms))}** • next in **${formatDuration(remainingMs)}**`;
    }).join('\n');

    return interaction.reply({
      content: `🗓️ Auto messages (${rows.length}/${limit})\n${list}`,
      flags: MessageFlags.Ephemeral
    });
  }
};

function parseDurationMs(input) {
  if (!input) return null;

  const normalized = input.toLowerCase().trim();
  const matcher = /(\d+)\s*([hms])/g;

  let total = 0;
  let found = false;
  let consumed = '';
  let match;

  while ((match = matcher.exec(normalized)) !== null) {
    found = true;
    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }

    if (unit === 'h') total += amount * 60 * 60 * 1000;
    if (unit === 'm') total += amount * 60 * 1000;
    if (unit === 's') total += amount * 1000;

    consumed += match[0];
  }

  if (!found) return null;

  const compactInput = normalized.replace(/\s+/g, '');
  const compactConsumed = consumed.replace(/\s+/g, '');
  if (compactInput !== compactConsumed) {
    return null;
  }

  return total;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

module.exports.parseDurationMs = parseDurationMs;
module.exports.formatDuration = formatDuration;
