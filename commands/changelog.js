const { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Configure server changelog following')
    .addSubcommand(sub =>
      sub.setName('channel')
        .setDescription('Set changelog channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addRoleOption(o => o.setName('ping_role').setDescription('Optional role to ping').setRequired(false))
    )
    .addSubcommand(sub => sub.setName('stop_following').setDescription('Disable changelog in this server')),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '⚠️ You need administrator or the configured bot manager role to use this command.', flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'stop_following') {
      await query('DELETE FROM changelog_followers WHERE guild_id = ?', [interaction.guildId]);
      return interaction.reply({ content: '✅ This server is no longer following changelogs.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('ping_role');
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.reply({ content: '⚠️ I cannot send messages in that channel. Please fix channel permissions and try again.', flags: MessageFlags.Ephemeral });
    }

    await query(
      `REPLACE INTO changelog_followers (guild_id, channel_id, ping_role_id, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [interaction.guildId, channel.id, role?.id || null, interaction.user.id, Date.now()]
    );

    return interaction.reply({ content: `✅ Changelog channel set to ${channel}${role ? ` with ping role ${role}` : ''}.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
};
