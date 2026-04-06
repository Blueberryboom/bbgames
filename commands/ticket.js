const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const {
  parseCooldown,
  formatDuration,
  getGuildTicketSettings,
  buildWorkloadEmbed
} = require('../utils/ticketSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system configuration and controls')
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure base ticket settings')
        .addChannelOption(opt =>
          opt.setName('ticket_category')
            .setDescription('Category where ticket channels are created')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('max_tickets_per_user')
            .setDescription('Max open tickets per user (1-5)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(5)
        )
        .addStringOption(opt =>
          opt.setName('panel_message')
            .setDescription('Description shown on ticket panels')
            .setRequired(true)
            .setMaxLength(1800)
        )
        .addBooleanOption(opt =>
          opt.setName('enable_ticket_claiming')
            .setDescription('Whether claim button is enabled')
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt.setName('transcripts_channel')
            .setDescription('Optional transcript log channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('blacklist_user')
        .setDescription('Blacklist a user from opening tickets')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('User to blacklist')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('creation_cooldown')
        .setDescription('Set ticket creation cooldown (e.g. 2d 9h 54m)')
        .addStringOption(opt =>
          opt.setName('duration')
            .setDescription('Cooldown duration in days/hours/minutes')
            .setRequired(true)
            .setMaxLength(32)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription('Send a ticket panel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel to send ticket panel to')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addBooleanOption(opt =>
          opt.setName('show_workload')
            .setDescription('Show ticket workload embed below panel')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('open_hours')
            .setDescription('Optional open-hours note shown in panel')
            .setRequired(false)
            .setMaxLength(300)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('close_request')
        .setDescription('Ask ticket owner for close confirmation in a ticket channel')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'close_request') {
      const ticketRows = await query('SELECT id, user_id, type_id FROM tickets WHERE guild_id = ? AND channel_id = ? LIMIT 1', [interaction.guildId, interaction.channelId]);
      const ticket = ticketRows[0];
      if (!ticket) {
        return interaction.reply({ content: '❌ This command can only be used inside an open ticket channel.', flags: MessageFlags.Ephemeral });
      }

      const typeRows = await query('SELECT staff_role_ids FROM ticket_types WHERE guild_id = ? AND id = ? LIMIT 1', [interaction.guildId, ticket.type_id]);
      const staffRoleIds = typeRows[0] ? JSON.parse(typeRows[0].staff_role_ids || '[]') : [];
      const isStaff = await checkPerms(interaction) || staffRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
      if (!isStaff) {
        return interaction.reply({ content: '❌ Only ticket staff can send close requests.', flags: MessageFlags.Ephemeral });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_close_request_yes:${ticket.id}`)
          .setLabel('Yes, close this ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.channel.send({
        content: `<@${ticket.user_id}>, <@${interaction.user.id}> requested to close this ticket.`,
        components: [row],
        allowedMentions: { users: [ticket.user_id, interaction.user.id] }
      });

      return interaction.reply({ content: '✅ Close request sent to the ticket owner.', flags: MessageFlags.Ephemeral });
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use ticket configuration commands.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'config') {
      const category = interaction.options.getChannel('ticket_category', true);
      const transcripts = interaction.options.getChannel('transcripts_channel');
      const maxTickets = interaction.options.getInteger('max_tickets_per_user', true);
      const panelMessage = interaction.options.getString('panel_message', true).trim();
      const claimingEnabled = interaction.options.getBoolean('enable_ticket_claiming', true) ? 1 : 0;

      await query(
        `INSERT INTO ticket_settings
         (guild_id, category_id, transcripts_channel_id, max_tickets_per_user, panel_message, claiming_enabled, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           category_id = VALUES(category_id),
           transcripts_channel_id = VALUES(transcripts_channel_id),
           max_tickets_per_user = VALUES(max_tickets_per_user),
           panel_message = VALUES(panel_message),
           claiming_enabled = VALUES(claiming_enabled),
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [
          interaction.guildId,
          category.id,
          transcripts?.id || null,
          maxTickets,
          panelMessage,
          claimingEnabled,
          interaction.user.id,
          Date.now()
        ]
      );

      return interaction.reply({
        content: '✅ Ticket settings updated.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'blacklist_user') {
      const user = interaction.options.getUser('user', true);
      await query(
        `REPLACE INTO ticket_blacklist (guild_id, user_id, created_at, created_by)
         VALUES (?, ?, ?, ?)`,
        [interaction.guildId, user.id, Date.now(), interaction.user.id]
      );

      return interaction.reply({
        content: `✅ ${user} is now blacklisted from opening tickets.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    if (sub === 'creation_cooldown') {
      const raw = interaction.options.getString('duration', true);
      const cooldownMs = parseCooldown(raw);

      if (cooldownMs === null) {
        return interaction.reply({
          content: '❌ Invalid format. Use values like `2d 9h 54m`, `2h`, `4m`, or `1d 2m`.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `INSERT INTO ticket_settings (guild_id, creation_cooldown_ms, updated_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE creation_cooldown_ms = VALUES(creation_cooldown_ms), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
        [interaction.guildId, cooldownMs, interaction.user.id, Date.now()]
      );

      return interaction.reply({
        content: `✅ Ticket creation cooldown set to **${formatDuration(cooldownMs)}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'panel') {
      const targetChannel = interaction.options.getChannel('channel', true);
      const showWorkload = interaction.options.getBoolean('show_workload', true);
      const openHours = interaction.options.getString('open_hours')?.trim();

      const settings = await getGuildTicketSettings(interaction.guildId);
      if (!settings?.category_id) {
        return interaction.reply({
          content: '❌ Configure ticket settings first using `/ticket config`.',
          flags: MessageFlags.Ephemeral
        });
      }

      const types = await query('SELECT id, name FROM ticket_types WHERE guild_id = ? ORDER BY name ASC', [interaction.guildId]);
      if (!types.length) {
        return interaction.reply({
          content: '❌ No ticket types exist yet. Create one with `/tickets create_type` first.',
          flags: MessageFlags.Ephemeral
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Tickets')
        .setDescription([
          settings.panel_message || 'Open a ticket by selecting an option below.',
          openHours ? `\n🕒 **Open Hours:** ${openHours}` : ''
        ].filter(Boolean).join('\n'));

      const select = new StringSelectMenuBuilder()
        .setCustomId('ticket_panel_select')
        .setPlaceholder('Choose a ticket type to open')
        .addOptions(types.map(type => ({ label: type.name.slice(0, 100), value: `type_${type.id}` })));

      const row = new ActionRowBuilder().addComponents(select);
      await targetChannel.send({ embeds: [embed], components: [row] });

      if (showWorkload) {
        const useEmojis = process.env.CUSTOM_BOT_INSTANCE !== 'true';
        const workloadEmbed = await buildWorkloadEmbed(interaction.guildId, useEmojis);
        if (workloadEmbed) {
          await targetChannel.send({ embeds: [workloadEmbed] });
        }
      }

      return interaction.reply({
        content: `✅ Ticket panel sent in ${targetChannel}.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
