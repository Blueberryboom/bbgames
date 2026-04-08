const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { parseDuration } = require('../utils/suggestionSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestions')
    .setDescription('Manage server suggestions')
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure suggestions settings')
        .addChannelOption(opt => opt
          .setName('channel')
          .setDescription('Channel to send suggestions to')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true))
        .addBooleanOption(opt => opt
          .setName('create_thread')
          .setDescription('Create a thread for each suggestion')
          .setRequired(true))
        .addStringOption(opt => opt
          .setName('cooldown')
          .setDescription('Creation cooldown (e.g. 1d 2h 15m)')
          .setRequired(true)
          .setMaxLength(32))
        .addRoleOption(opt => opt.setName('allowed_role_1').setDescription('Optional role allowed to open suggestions').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_2').setDescription('Optional role allowed to open suggestions').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_3').setDescription('Optional role allowed to open suggestions').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_4').setDescription('Optional role allowed to open suggestions').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_5').setDescription('Optional role allowed to open suggestions').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable suggestions feature')
        .addStringOption(opt => opt
          .setName('time')
          .setDescription('Optional temporary disable time (e.g. 2d 7h 3m)')
          .setRequired(false)
          .setMaxLength(32))
    )
    .addSubcommand(sub =>
      sub
        .setName('blacklist_user')
        .setDescription('Blacklist user from creating suggestions')
        .addUserOption(opt => opt.setName('user').setDescription('User to blacklist').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('unblacklist_user')
        .setDescription('Remove user from suggestion blacklist')
        .addUserOption(opt => opt.setName('user').setDescription('User to unblacklist').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('create_category')
        .setDescription('Create a suggestion category')
        .addStringOption(opt => opt.setName('name').setDescription('Category name').setRequired(true).setMaxLength(80))
    )
    .addSubcommand(sub =>
      sub
        .setName('delete_category')
        .setDescription('Delete a suggestion category')
        .addStringOption(opt => opt.setName('name').setDescription('Category name').setRequired(true).setMaxLength(80))
    )
    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription('Send suggestions panel')
        .addChannelOption(opt => opt
          .setName('channel')
          .setDescription('Where to send the panel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true))
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      const channel = interaction.options.getChannel('channel', true);
      const createThread = interaction.options.getBoolean('create_thread', true) ? 1 : 0;
      const cooldownRaw = interaction.options.getString('cooldown', true);
      const cooldownMs = parseDuration(cooldownRaw);
      if (cooldownMs == null || cooldownMs < 2 * 60 * 1000) {
        return interaction.reply({ content: '❌ Cooldown must be a valid duration and greater than 2 minutes.', flags: MessageFlags.Ephemeral });
      }

      const allowedRoleIds = [];
      for (let i = 1; i <= 5; i++) {
        const role = interaction.options.getRole(`allowed_role_${i}`);
        if (role && !allowedRoleIds.includes(role.id)) allowedRoleIds.push(role.id);
      }

      await query(
        `INSERT INTO suggestion_settings
         (guild_id, channel_id, create_thread, allowed_role_ids, cooldown_ms, disabled_until, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
           channel_id = VALUES(channel_id),
           create_thread = VALUES(create_thread),
           allowed_role_ids = VALUES(allowed_role_ids),
           cooldown_ms = VALUES(cooldown_ms),
           disabled_until = NULL,
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, createThread, JSON.stringify(allowedRoleIds), cooldownMs, interaction.user.id, Date.now()]
      );

      return interaction.reply({ content: `✅ Suggestions configured for ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable') {
      const time = interaction.options.getString('time');
      if (!time) {
        await query('DELETE FROM suggestion_settings WHERE guild_id = ?', [interaction.guildId]);
        await query('DELETE FROM suggestion_categories WHERE guild_id = ?', [interaction.guildId]);
        await query('DELETE FROM suggestion_blacklist WHERE guild_id = ?', [interaction.guildId]);
        await query('DELETE FROM suggestion_user_activity WHERE guild_id = ?', [interaction.guildId]);
        await query('DELETE FROM suggestions WHERE guild_id = ?', [interaction.guildId]);
        return interaction.reply({ content: '✅ Suggestions feature disabled and all suggestion data deleted.', flags: MessageFlags.Ephemeral });
      }

      const durationMs = parseDuration(time);
      if (durationMs == null || durationMs < 2 * 60 * 1000) {
        return interaction.reply({ content: '❌ Time must be a valid duration and greater than 2 minutes.', flags: MessageFlags.Ephemeral });
      }

      const exists = await query('SELECT guild_id FROM suggestion_settings WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
      if (!exists.length) {
        return interaction.reply({ content: '❌ Suggestions are not configured yet.', flags: MessageFlags.Ephemeral });
      }

      const disabledUntil = Date.now() + durationMs;
      await query('UPDATE suggestion_settings SET disabled_until = ?, updated_by = ?, updated_at = ? WHERE guild_id = ?', [disabledUntil, interaction.user.id, Date.now(), interaction.guildId]);
      return interaction.reply({ content: `✅ Suggestions temporarily disabled until <t:${Math.floor(disabledUntil / 1000)}:F>.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'blacklist_user') {
      const user = interaction.options.getUser('user', true);
      await query('REPLACE INTO suggestion_blacklist (guild_id, user_id, created_by, created_at) VALUES (?, ?, ?, ?)', [interaction.guildId, user.id, interaction.user.id, Date.now()]);
      return interaction.reply({ content: `✅ ${user} is now blacklisted from suggestions.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    if (sub === 'unblacklist_user') {
      const user = interaction.options.getUser('user', true);
      await query('DELETE FROM suggestion_blacklist WHERE guild_id = ? AND user_id = ?', [interaction.guildId, user.id]);
      return interaction.reply({ content: `✅ ${user} was removed from the suggestions blacklist.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    if (sub === 'create_category') {
      const name = interaction.options.getString('name', true).trim();
      await query('INSERT INTO suggestion_categories (guild_id, name, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [interaction.guildId, name, Date.now()]);
      return interaction.reply({ content: `✅ Created suggestion category **${name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete_category') {
      const name = interaction.options.getString('name', true).trim();
      const result = await query('DELETE FROM suggestion_categories WHERE guild_id = ? AND name = ?', [interaction.guildId, name]);
      if (!result.affectedRows) {
        return interaction.reply({ content: '❌ Category not found.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `✅ Deleted suggestion category **${name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'panel') {
      const channel = interaction.options.getChannel('channel', true);

      const panelEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('Suggestions')
        .setDescription('Click the button below to suggest a change to the server!');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('suggestions_open_modal')
          .setLabel('Open Suggestion')
          .setStyle(ButtonStyle.Primary)
      );

      await channel.send({ embeds: [panelEmbed], components: [row] });
      await query('UPDATE suggestion_settings SET panel_channel_id = ? WHERE guild_id = ?', [channel.id, interaction.guildId]);

      return interaction.reply({ content: `✅ Suggestions panel sent in ${channel}.`, flags: MessageFlags.Ephemeral });
    }
  }
};
