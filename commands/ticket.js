const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const {
  parseCooldown,
  formatDuration,
  getGuildTicketSettings,
  buildWorkloadEmbed,
  parseRoleIds
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
          opt.setName('active_hours')
            .setDescription('Optional active-hours note shown in panel')
            .setRequired(false)
            .setMaxLength(300)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('delete_type')
        .setDescription('Delete an existing ticket type')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Name of the ticket type to delete')
            .setRequired(true)
            .setMaxLength(80)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Delete all ticket channels and remove all ticket configuration')
    )
    .addSubcommand(sub =>
      sub
        .setName('close_request')
        .setDescription('Ask ticket owner for close confirmation in a ticket channel')
    )
    .addSubcommand(sub =>
      sub
        .setName('unclaim')
        .setDescription('Unclaim a claimed ticket in a ticket channel')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'close_request') {
      const ticketRows = await query('SELECT id, user_id, type_id, claimed_by FROM tickets WHERE guild_id = ? AND channel_id = ? LIMIT 1', [interaction.guildId, interaction.channelId]);
      const ticket = ticketRows[0];
      if (!ticket) {
        return interaction.reply({ content: '❌ This command can only be used inside an open ticket channel.', flags: MessageFlags.Ephemeral });
      }

      const typeRows = await query('SELECT staff_role_ids FROM ticket_types WHERE guild_id = ? AND id = ? LIMIT 1', [interaction.guildId, ticket.type_id]);
      const staffRoleIds = typeRows[0] ? JSON.parse(typeRows[0].staff_role_ids || '[]') : [];
      const isAssigned = ticket.claimed_by && interaction.user.id === ticket.claimed_by;
      const isStaff = await checkPerms(interaction) || isAssigned || staffRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
      if (!isStaff) {
        return interaction.reply({ content: '❌ Only assigned ticket staff or administrators can send close requests.', flags: MessageFlags.Ephemeral });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_close_request_yes:${ticket.id}`)
          .setLabel('✅ Yes, close this ticket')
          .setStyle(ButtonStyle.Danger)
      );

      const mentionUserIds = Array.from(new Set([ticket.user_id, interaction.user.id]));
      await interaction.channel.send({
        content: `<@${ticket.user_id}>, <@${interaction.user.id}> requested to close this ticket.`,
        components: [row],
        allowedMentions: { users: mentionUserIds }
      });

      return interaction.reply({ content: '✅ Close request sent to the ticket owner.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'unclaim') {
      const ticketRows = await query(
        `SELECT t.id, t.user_id, t.type_id, t.claimed_by, tt.staff_role_ids
         FROM tickets t
         INNER JOIN ticket_types tt ON tt.guild_id = t.guild_id AND tt.id = t.type_id
         WHERE t.guild_id = ? AND t.channel_id = ?
         LIMIT 1`,
        [interaction.guildId, interaction.channelId]
      );
      const ticket = ticketRows[0];
      if (!ticket) {
        return interaction.reply({ content: '❌ This command can only be used inside an open ticket channel.', flags: MessageFlags.Ephemeral });
      }

      if (!ticket.claimed_by) {
        return interaction.reply({ content: '❌ This ticket is not currently claimed.', flags: MessageFlags.Ephemeral });
      }

      const staffRoleIds = parseRoleIds(ticket.staff_role_ids);
      const isStaff = await checkPerms(interaction) || staffRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
      const isClaimer = interaction.user.id === ticket.claimed_by;
      if (!isStaff && !isClaimer) {
        return interaction.reply({ content: '❌ Only the claimer, ticket staff, or admins can unclaim this ticket.', flags: MessageFlags.Ephemeral });
      }

      await query('UPDATE tickets SET claimed_by = NULL WHERE id = ?', [ticket.id]);

      const claimControlId = `ticket_claim:${ticket.id}`;
      const messages = await interaction.channel.messages.fetch({ limit: 25 }).catch(() => null);
      const controlMessage = messages?.find(message =>
        message.components?.some(row =>
          row.components?.some(component => component.customId === claimControlId)
        )
      );

      if (controlMessage) {
        const updatedRows = controlMessage.components.map(row => new ActionRowBuilder().addComponents(
          row.components.map(component => {
            if (component.customId === claimControlId) {
              return ButtonBuilder.from(component)
                .setLabel('🙋 Claim')
                .setStyle(ButtonStyle.Success)
                .setDisabled(false);
            }
            return ButtonBuilder.from(component);
          })
        ));
        await controlMessage.edit({ components: updatedRows }).catch(() => null);
      }

      const unclaimEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('Ticket unclaimed!')
        .setDescription(`This ticket was unclaimed by ${interaction.user}.`);
      await interaction.channel.send({ embeds: [unclaimEmbed] }).catch(() => null);

      return interaction.reply({ content: '✅ Ticket is now unclaimed.', flags: MessageFlags.Ephemeral });
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
      const claimingEnabled = interaction.options.getBoolean('enable_ticket_claiming', true) ? 1 : 0;
      const modalCustomId = `ticket_config_panel_message:${interaction.id}`;
      const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle('Ticket Panel Message');

      const panelMessageInput = new TextInputBuilder()
        .setCustomId('panel_message')
        .setLabel('Panel description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Open a ticket by selecting an option below.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1800);

      modal.addComponents(new ActionRowBuilder().addComponents(panelMessageInput));
      await interaction.showModal(modal);

      const modalSubmit = await interaction.awaitModalSubmit({
        time: 120000,
        filter: submit =>
          submit.customId === modalCustomId
          && submit.user.id === interaction.user.id
      }).catch(() => null);

      if (!modalSubmit) {
        return interaction.followUp({
          content: '⏱️ Timed out waiting for panel message input. Please run `/ticket config` again.',
          flags: MessageFlags.Ephemeral
        });
      }

      const panelMessage = modalSubmit.fields.getTextInputValue('panel_message').trim();

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

      return modalSubmit.reply({
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
      const activeHours = interaction.options.getString('active_hours')?.trim();

      const settings = await getGuildTicketSettings(interaction.guildId);
      if (!settings?.category_id) {
        return interaction.reply({
          content: '❌ Configure ticket settings first using `/ticket config`.',
          flags: MessageFlags.Ephemeral
        });
      }

      const types = await query('SELECT id, name, description FROM ticket_types WHERE guild_id = ? ORDER BY name ASC', [interaction.guildId]);
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
          activeHours ? `\n🕒 **Active Hours:** ${activeHours}` : ''
        ].filter(Boolean).join('\n'));

      const select = new StringSelectMenuBuilder()
        .setCustomId('ticket_panel_select')
        .setPlaceholder('Choose a ticket type to open')
        .addOptions(
          types.map(type => ({
            label: type.name.slice(0, 100),
            description: type.description ? type.description.slice(0, 60) : undefined,
            value: `type_${type.id}`
          }))
        );

      const row = new ActionRowBuilder().addComponents(select);
      await targetChannel.send({ embeds: [embed], components: [row] });

      if (showWorkload) {
        const useEmojis = process.env.CUSTOM_BOT_INSTANCE !== 'true';
        const workloadEmbed = await buildWorkloadEmbed(interaction.guildId, useEmojis);
        if (workloadEmbed) {
          const workloadMessage = await targetChannel.send({ embeds: [workloadEmbed] });
          await query(
            `UPDATE ticket_settings
             SET workload_channel_id = ?, workload_message_id = ?, updated_by = ?, updated_at = ?
             WHERE guild_id = ?`,
            [targetChannel.id, workloadMessage.id, interaction.user.id, Date.now(), interaction.guildId]
          );
        }
      } else {
        await query(
          `UPDATE ticket_settings
           SET workload_channel_id = NULL, workload_message_id = NULL, updated_by = ?, updated_at = ?
           WHERE guild_id = ?`,
          [interaction.user.id, Date.now(), interaction.guildId]
        );
      }

      return interaction.reply({
        content: `✅ Ticket panel sent in ${targetChannel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'delete_type') {
      const name = interaction.options.getString('name', true).trim();
      const typeRows = await query(
        `SELECT id, name
         FROM ticket_types
         WHERE guild_id = ? AND LOWER(name) = LOWER(?)
         LIMIT 1`,
        [interaction.guildId, name]
      );
      const type = typeRows[0];
      if (!type) {
        return interaction.reply({ content: '❌ Ticket type not found.', flags: MessageFlags.Ephemeral });
      }

      const openRows = await query(
        'SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND type_id = ?',
        [interaction.guildId, type.id]
      );
      const openCount = Number(openRows[0]?.total || 0);
      if (openCount > 0) {
        return interaction.reply({
          content: `❌ Cannot delete **${type.name}** while it has open tickets (${openCount}).`,
          flags: MessageFlags.Ephemeral
        });
      }

      await query('DELETE FROM ticket_types WHERE guild_id = ? AND id = ?', [interaction.guildId, type.id]);
      return interaction.reply({
        content: `✅ Deleted ticket type **${type.name}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'reset') {
      const openTickets = await query(
        'SELECT id, channel_id FROM tickets WHERE guild_id = ?',
        [interaction.guildId]
      );

      let deletedChannels = 0;
      for (const ticket of openTickets) {
        const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          await channel.delete(`Ticket reset by ${interaction.user.tag} (${interaction.user.id})`).catch(() => null);
          deletedChannels += 1;
        }
      }

      await query('DELETE FROM tickets WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM ticket_types WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM ticket_blacklist WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM ticket_user_activity WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM ticket_settings WHERE guild_id = ?', [interaction.guildId]);

      return interaction.reply({
        content: `✅ Ticket system fully reset. Removed ${deletedChannels} ticket channel(s) and all ticket configuration.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
