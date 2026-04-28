const { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { parseDurationMs } = require('../utils/autoReviveManager');

const MIN_MS = 30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorevive')
    .setDescription('Automatically revive inactive chat channels')
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable auto chat revive')
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addRoleOption(o => o.setName('ping_role').setDescription('Role to ping').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('Inactivity time (e.g. 2d 3h, 5m)').setRequired(true).setMaxLength(32))
        .addStringOption(o => o.setName('message').setDescription('Optional custom message with [$role], max 100 chars').setRequired(false).setMaxLength(100))
    )
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable auto chat revive')),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '⚠️ You need administrator or the configured bot manager role to use this command.', flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'disable') {
      await query('DELETE FROM auto_revive_configs WHERE guild_id = ?', [interaction.guildId]);
      return interaction.reply({ content: '✅ Auto revive disabled and removed from the database.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('ping_role', true);
    const rawTime = interaction.options.getString('time', true);
    const customMessage = interaction.options.getString('message')?.trim() || "Hey, let's get this chat rolling again! [$role]";

    const durationMs = parseDurationMs(rawTime);
    if (!durationMs || durationMs < MIN_MS) {
      return interaction.reply({ content: '⚠️ Invalid time. Minimum is **30 minutes** and format must use d/h/m (example: `1h 30m`).', flags: MessageFlags.Ephemeral });
    }

    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.reply({ content: '⚠️ I need **View Channel** and **Send Messages** in that channel to use auto revive.', flags: MessageFlags.Ephemeral });
    }

    const now = Date.now();
    await query(
      `REPLACE INTO auto_revive_configs
       (guild_id, channel_id, ping_role_id, inactivity_ms, message_template, last_activity_at, last_sent_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [interaction.guildId, channel.id, role.id, durationMs, customMessage.slice(0, 100), now, interaction.user.id, now]
    );

    return interaction.reply({
      content: `✅ Auto revive enabled in ${channel}. It will trigger after **${rawTime}** of inactivity.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }
};
