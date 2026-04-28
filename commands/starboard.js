const { SlashCommandBuilder, ChannelType, MessageFlags, EmbedBuilder } = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');
const {
  normalizeEmojiInput,
  parseHexColor,
  formatStoredEmoji,
  invalidateGuildCache
} = require('../utils/starboardManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Configure automatic starboard reposting')
    .addSubcommand(sub =>
      sub
        .setName('configure')
        .setDescription('Create or update a starboard config')
        .addStringOption(option => option.setName('name').setDescription('Unique config name').setRequired(true).setMaxLength(40))
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel where starboard posts are sent')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true))
        .addStringOption(option => option.setName('emoji').setDescription('Reaction emoji').setRequired(true).setMaxLength(64))
        .addIntegerOption(option => option.setName('amount').setDescription('Minimum reactions').setRequired(true).setMinValue(1).setMaxValue(100))
        .addStringOption(option => option.setName('color').setDescription('Optional embed color (hex, ex: #191919)').setRequired(false).setMaxLength(7))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List configured starboards'))
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Delete a starboard config')
        .addStringOption(option => option.setName('name').setDescription('Config name').setRequired(true).setMaxLength(40))
    )
    .addSubcommand(sub =>
      sub
        .setName('ban_user')
        .setDescription('Ban a user from appearing on all server starboards')
        .addUserOption(option => option.setName('user').setDescription('User to ban').setRequired(true))
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'configure') {
      const rawName = interaction.options.getString('name', true).trim().toLowerCase();
      const channel = interaction.options.getChannel('channel', true);
      const rawEmoji = interaction.options.getString('emoji', true).trim();
      const amount = interaction.options.getInteger('amount', true);
      const colorInput = interaction.options.getString('color', false);

      if (!/^[a-z0-9-_]{2,40}$/.test(rawName)) {
        return interaction.reply({ content: '⚠️ Name must be 2-40 chars and use lowercase letters, numbers, dashes, or underscores.', flags: MessageFlags.Ephemeral });
      }

      const normalizedEmoji = normalizeEmojiInput(rawEmoji);
      if (!normalizedEmoji) {
        return interaction.reply({ content: '⚠️ Invalid emoji input. Use a Unicode emoji or custom emoji like <:name:id>.', flags: MessageFlags.Ephemeral });
      }

      const embedColor = colorInput ? parseHexColor(colorInput) : null;
      if (colorInput && embedColor == null) {
        return interaction.reply({ content: '⚠️ Color must be a valid hex code such as #191919 or 191919.', flags: MessageFlags.Ephemeral });
      }

      const countRows = await query(
        `SELECT COUNT(*) AS total
         FROM starboard_configs
         WHERE guild_id = ?`,
        [interaction.guildId]
      );

      const existsRows = await query(
        `SELECT id
         FROM starboard_configs
         WHERE guild_id = ? AND name = ?
         LIMIT 1`,
        [interaction.guildId, rawName]
      );

      const exists = Boolean(existsRows.length);
      const total = Number(countRows[0]?.total || 0);
      const limit = await getPremiumLimit(interaction.client, interaction.guildId, 2, 5);

      if (!exists && total >= limit) {
        return interaction.reply({ content: `⚠️ Starboard limit reached (${limit}).`, flags: MessageFlags.Ephemeral });
      }

      await query(
        `INSERT INTO starboard_configs
         (guild_id, name, channel_id, reaction_emoji, min_reactions, embed_color, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           channel_id = VALUES(channel_id),
           reaction_emoji = VALUES(reaction_emoji),
           min_reactions = VALUES(min_reactions),
           embed_color = VALUES(embed_color),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, rawName, channel.id, normalizedEmoji, amount, embedColor, interaction.user.id, Date.now()]
      );

      invalidateGuildCache(interaction.guildId);

      return interaction.reply({
        content: `✅ Starboard \`${rawName}\` saved: channel ${channel}, emoji ${formatStoredEmoji(normalizedEmoji)}, threshold **${amount}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'list') {
      const rows = await query(
        `SELECT name, channel_id, reaction_emoji, min_reactions, embed_color
         FROM starboard_configs
         WHERE guild_id = ?
         ORDER BY name ASC`,
        [interaction.guildId]
      );

      if (!rows.length) {
        return interaction.reply({ content: 'ℹ️ No starboards configured yet.', flags: MessageFlags.Ephemeral });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⭐ Starboard Configurations')
        .setDescription(rows.map(row => {
          const colorText = row.embed_color != null ? `#${Number(row.embed_color).toString(16).padStart(6, '0').toUpperCase()}` : 'default';
          return `• **${row.name}** → <#${row.channel_id}>\n  Emoji: ${formatStoredEmoji(row.reaction_emoji)} • Min: ${row.min_reactions} • Color: ${colorText}`;
        }).join('\n\n'));

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'remove') {
      const rawName = interaction.options.getString('name', true).trim().toLowerCase();

      const configRows = await query(
        `SELECT id
         FROM starboard_configs
         WHERE guild_id = ? AND name = ?
         LIMIT 1`,
        [interaction.guildId, rawName]
      );

      if (!configRows.length) {
        return interaction.reply({ content: '⚠️ Starboard config not found.', flags: MessageFlags.Ephemeral });
      }

      const configId = configRows[0].id;

      await query('DELETE FROM starboard_posts WHERE guild_id = ? AND config_id = ?', [interaction.guildId, configId]);
      await query('DELETE FROM starboard_configs WHERE guild_id = ? AND id = ?', [interaction.guildId, configId]);
      invalidateGuildCache(interaction.guildId);

      return interaction.reply({ content: `✅ Removed starboard \`${rawName}\`.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'ban_user') {
      const target = interaction.options.getUser('user', true);

      await query(
        `REPLACE INTO starboard_banned_users (guild_id, user_id, created_at)
         VALUES (?, ?, ?)`,
        [interaction.guildId, target.id, Date.now()]
      );

      invalidateGuildCache(interaction.guildId);
      return interaction.reply({ content: `✅ <@${target.id}> is now banned from all starboards in this server.`, flags: MessageFlags.Ephemeral });
    }
  }
};
