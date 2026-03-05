const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Manage YouTube upload notifications')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a YouTube channel notification subscription')
        .addStringOption(o => o.setName('channel_id').setDescription('YouTube channel ID (UC...)').setRequired(true))
        .addChannelOption(o => o.setName('target_channel').setDescription('Discord channel to post notifications').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption(o => o.setName('ping_role').setDescription('Optional role to ping on upload').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a YouTube channel notification subscription')
        .addStringOption(o => o.setName('channel_id').setDescription('YouTube channel ID (UC...)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List YouTube notification subscriptions')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission to use this.', flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const channelId = interaction.options.getString('channel_id').trim();
      const targetChannel = interaction.options.getChannel('target_channel');
      const pingRole = interaction.options.getRole('ping_role');

      if (!/^UC[\w-]{10,}$/.test(channelId)) {
        return interaction.reply({ content: '❌ Invalid YouTube channel ID format. It should look like `UC...`', flags: MessageFlags.Ephemeral });
      }

      await query(
        `REPLACE INTO youtube_subscriptions
         (guild_id, youtube_channel_id, discord_channel_id, ping_role_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [interaction.guild.id, channelId, targetChannel.id, pingRole?.id || null, Date.now()]
      );

      return interaction.reply({
        content: `✅ YouTube notifications configured for \`${channelId}\` in ${targetChannel}${pingRole ? ` (ping ${pingRole})` : ''}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'remove') {
      const channelId = interaction.options.getString('channel_id').trim();

      await query(
        `DELETE FROM youtube_subscriptions
         WHERE guild_id = ? AND youtube_channel_id = ?`,
        [interaction.guild.id, channelId]
      );

      return interaction.reply({ content: `✅ Removed YouTube subscription for \`${channelId}\`.`, flags: MessageFlags.Ephemeral });
    }

    const rows = await query(
      `SELECT youtube_channel_id, discord_channel_id, ping_role_id
       FROM youtube_subscriptions
       WHERE guild_id = ?
       ORDER BY updated_at DESC`,
      [interaction.guild.id]
    );

    if (!rows.length) {
      return interaction.reply({ content: 'No YouTube subscriptions are configured.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('📺 YouTube Subscriptions')
      .setDescription(
        rows.map(row =>
          `• \`${row.youtube_channel_id}\` → <#${row.discord_channel_id}>${row.ping_role_id ? ` (ping <@&${row.ping_role_id}>)` : ''}`
        ).join('\n')
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
