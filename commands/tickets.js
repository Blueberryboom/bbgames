const {
  SlashCommandBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');
const { parseCooldown, formatDuration } = require('../utils/ticketSystem');
const { LOG_EVENT_KEYS, logGuildEvent } = require('../utils/guildLogger');

const AUTOMATION_NAME_PATTERN = /^[A-Za-z ]{1,64}$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Manage ticket types and automations')
    .addSubcommand(sub =>
      sub
        .setName('create_type')
        .setDescription('Create a ticket type')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Ticket type name')
            .setRequired(true)
            .setMaxLength(80)
        )
        .addStringOption(opt =>
          opt.setName('prefix')
            .setDescription('Required ticket name prefix (max 8 chars)')
            .setRequired(true)
            .setMaxLength(8)
        )
        .addStringOption(opt =>
          opt.setName('panel_dropdown_desc')
            .setDescription('Optional: shown only in the ticket panel dropdown (max 60 chars)')
            .setRequired(false)
            .setMaxLength(60)
        )
        .addRoleOption(opt => opt.setName('allowed_role_1').setDescription('Role allowed to open this type').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_2').setDescription('Role allowed to open this type').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_3').setDescription('Role allowed to open this type').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_4').setDescription('Role allowed to open this type').setRequired(false))
        .addRoleOption(opt => opt.setName('allowed_role_5').setDescription('Role allowed to open this type').setRequired(false))
        .addRoleOption(opt => opt.setName('staff_role_1').setDescription('Staff role that can see this type').setRequired(false))
        .addRoleOption(opt => opt.setName('staff_role_2').setDescription('Staff role that can see this type').setRequired(false))
        .addRoleOption(opt => opt.setName('staff_role_3').setDescription('Staff role that can see this type').setRequired(false))
        .addRoleOption(opt => opt.setName('staff_role_4').setDescription('Staff role that can see this type').setRequired(false))
        .addRoleOption(opt => opt.setName('staff_role_5').setDescription('Staff role that can see this type').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('create_automation')
        .setDescription('Create a ticket automation')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Automation name (letters and spaces only)')
            .setRequired(true)
            .setMaxLength(64)
        )
        .addStringOption(opt =>
          opt.setName('ticket_type')
            .setDescription('Ticket type name this automation applies to')
            .setRequired(true)
            .setMaxLength(80)
        )
        .addStringOption(opt =>
          opt.setName('trigger')
            .setDescription('How the timer behaves')
            .setRequired(true)
            .addChoices(
              { name: 'time (since ticket creation)', value: 'time' },
              { name: 'time without message activity', value: 'time_without_message' }
            )
        )
        .addStringOption(opt =>
          opt.setName('time')
            .setDescription('Duration like 2d 4h 15m, 2h 2m, 5d 1h')
            .setRequired(true)
            .setMaxLength(32)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list_automations')
        .setDescription('List ticket automations')
    )
    .addSubcommand(sub =>
      sub
        .setName('delete_automation')
        .setDescription('Delete a ticket automation')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Automation name')
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable_automation')
        .setDescription('Disable an automation temporarily')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Automation name')
            .setRequired(true)
            .setMaxLength(64)
        )
        .addStringOption(opt =>
          opt.setName('time')
            .setDescription('Disable duration in d/h/m format')
            .setRequired(true)
            .setMaxLength(32)
        )
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to manage ticket settings.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'create_type') {
      const name = interaction.options.getString('name', true).trim();
      const prefix = interaction.options.getString('prefix', true).trim();
      const shortDescription = interaction.options.getString('panel_dropdown_desc')?.trim() || null;

      if (!/^[a-zA-Z0-9-]{1,8}$/.test(prefix)) {
        return interaction.reply({
          content: '❌ Prefix must be 1-8 characters and only use letters, numbers, or hyphens.',
          flags: MessageFlags.Ephemeral
        });
      }

      const allowedRoleIds = [];
      const staffRoleIds = [];

      for (let i = 1; i <= 5; i++) {
        const allowedRole = interaction.options.getRole(`allowed_role_${i}`);
        if (allowedRole && !allowedRoleIds.includes(allowedRole.id)) {
          allowedRoleIds.push(allowedRole.id);
        }

        const staffRole = interaction.options.getRole(`staff_role_${i}`);
        if (staffRole && !staffRoleIds.includes(staffRole.id)) {
          staffRoleIds.push(staffRole.id);
        }
      }

      if (!staffRoleIds.length) {
        return interaction.reply({
          content: '❌ You must set at least one staff role for visibility and ticket handling.',
          flags: MessageFlags.Ephemeral
        });
      }

      const exists = await query(
        'SELECT id FROM ticket_types WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
        [interaction.guildId, name]
      );

      if (exists.length) {
        return interaction.reply({
          content: '❌ A ticket type with this name already exists.',
          flags: MessageFlags.Ephemeral
        });
      }

      const typeCountRows = await query(
        `SELECT COUNT(*) AS total
         FROM ticket_types
         WHERE guild_id = ?`,
        [interaction.guildId]
      );
      const currentCount = Number(typeCountRows[0]?.total || 0);
      const maxTypes = await getPremiumLimit(interaction.client, interaction.guildId, 6, 15);
      if (currentCount >= maxTypes) {
        return interaction.reply({
          content: `❌ This server already has the max number of ticket types (**${maxTypes}**).`,
          flags: MessageFlags.Ephemeral
        });
      }

      const modalCustomId = `ticket_type_welcome_message:${interaction.id}`;
      const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle('Ticket Welcome Message');

      const welcomeMessageInput = new TextInputBuilder()
        .setCustomId('welcome_message')
        .setLabel('Welcome embed description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Please explain your issue in detail...')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1800);

      modal.addComponents(new ActionRowBuilder().addComponents(welcomeMessageInput));
      await interaction.showModal(modal);

      const modalSubmit = await interaction.awaitModalSubmit({
        time: 120000,
        filter: submit =>
          submit.customId === modalCustomId
          && submit.user.id === interaction.user.id
      }).catch(() => null);

      if (!modalSubmit) {
        return interaction.followUp({
          content: '⏱️ Timed out waiting for welcome message input. Please run `/tickets create_type` again.',
          flags: MessageFlags.Ephemeral
        });
      }

      const welcomeMessage = modalSubmit.fields.getTextInputValue('welcome_message').trim();

      await query(
        `INSERT INTO ticket_types
         (guild_id, name, description, prefix, allowed_role_ids, staff_role_ids, welcome_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          interaction.guildId,
          name,
          shortDescription,
          prefix.toUpperCase(),
          JSON.stringify(allowedRoleIds),
          JSON.stringify(staffRoleIds),
          welcomeMessage,
          Date.now()
        ]
      );

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: 'Ticket Type Created',
        description: `${interaction.user} created ticket type **${name}**.`
      }).catch(() => null);

      return modalSubmit.reply({
        content: `✅ Created ticket type **${name}** with ${staffRoleIds.length} staff role(s).`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    if (sub === 'create_automation') {
      const name = interaction.options.getString('name', true).trim();
      const ticketTypeName = interaction.options.getString('ticket_type', true).trim();
      const trigger = interaction.options.getString('trigger', true);
      const rawTime = interaction.options.getString('time', true);
      const durationMs = parseCooldown(rawTime);

      if (!AUTOMATION_NAME_PATTERN.test(name)) {
        return interaction.reply({
          content: '❌ Automation names must be plain letters/spaces only (1-64 chars).',
          flags: MessageFlags.Ephemeral
        });
      }

      if (durationMs === null || durationMs <= 0) {
        return interaction.reply({
          content: '❌ Invalid time. Use format like `2d 4h 15m`, `1d 2m`, or `2h 2m`.',
          flags: MessageFlags.Ephemeral
        });
      }

      const typeRows = await query(
        `SELECT id, name
         FROM ticket_types
         WHERE guild_id = ? AND LOWER(name) = LOWER(?)
         LIMIT 1`,
        [interaction.guildId, ticketTypeName]
      );
      const type = typeRows[0];
      if (!type) {
        return interaction.reply({
          content: `❌ Ticket type **${ticketTypeName}** was not found.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const existing = await query(
        'SELECT id FROM ticket_automations WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
        [interaction.guildId, name]
      );
      if (existing.length) {
        return interaction.reply({ content: '❌ A ticket automation with this name already exists.', flags: MessageFlags.Ephemeral });
      }

      const countRows = await query('SELECT COUNT(*) AS total FROM ticket_automations WHERE guild_id = ?', [interaction.guildId]);
      const maxAutomations = await getPremiumLimit(interaction.client, interaction.guildId, 4, 20);
      if (Number(countRows[0]?.total || 0) >= maxAutomations) {
        return interaction.reply({
          content: `❌ This server already has the maximum ticket automations (${maxAutomations}).`,
          flags: MessageFlags.Ephemeral
        });
      }

      const promptId = `ticket_automation_action:${interaction.id}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${promptId}:send_message`).setLabel('Send message').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${promptId}:send_close_request`).setLabel('Send close request').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${promptId}:close`).setLabel('Close ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${promptId}:send_alert`).setLabel('Send alert log').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content: `Choose what should happen after **${formatDuration(durationMs)}** (${trigger === 'time' ? 'from ticket creation' : 'without messages'}).`,
        components: [row],
        flags: MessageFlags.Ephemeral
      });

      const promptMessage = await interaction.fetchReply().catch(() => null);
      const choice = await promptMessage?.awaitMessageComponent({
        time: 300000,
        filter: component => component.user.id === interaction.user.id && component.customId.startsWith(promptId)
      }).catch(() => null);

      if (!choice) {
        await interaction.editReply({ content: '⏱️ Automation setup expired after 5 minutes.', components: [] }).catch(() => null);
        return;
      }

      const actionType = choice.customId.split(':')[2];
      let actionMessage = null;

      if (actionType === 'send_message') {
        const modalId = `ticket_automation_message:${interaction.id}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Automation Message');
        const msgInput = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Message to send when triggered')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1800);
        modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
        await choice.showModal(modal);

        const modalSubmit = await choice.awaitModalSubmit({
          time: 300000,
          filter: submit => submit.customId === modalId && submit.user.id === interaction.user.id
        }).catch(() => null);

        if (!modalSubmit) {
          await interaction.editReply({ content: '⏱️ Automation message form expired after 5 minutes.', components: [] }).catch(() => null);
          return;
        }

        actionMessage = modalSubmit.fields.getTextInputValue('message').trim();
        await modalSubmit.deferUpdate().catch(() => null);
      } else {
        await choice.update({ content: 'Saving ticket automation…', components: [] }).catch(() => null);
      }

      const now = Date.now();
      await query(
        `INSERT INTO ticket_automations
         (guild_id, name, ticket_type_id, trigger_mode, duration_ms, action_type, action_message, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [interaction.guildId, name, type.id, trigger, durationMs, actionType, actionMessage, interaction.user.id, now, now]
      );

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: 'Ticket Automation Created',
        description: `${interaction.user} created automation **${name}**.`,
        fields: [
          { name: 'Type', value: type.name, inline: true },
          { name: 'Trigger', value: trigger, inline: true },
          { name: 'Action', value: actionType, inline: true }
        ]
      }).catch(() => null);

      return interaction.editReply({
        content: `✅ Created ticket automation **${name}** for **${type.name}** (${formatDuration(durationMs)} → ${actionType.replaceAll('_', ' ')}).`,
        components: []
      });
    }

    if (sub === 'list_automations') {
      const rows = await query(
        `SELECT a.name, a.trigger_mode, a.duration_ms, a.action_type, a.disabled_until, t.name AS type_name
         FROM ticket_automations a
         INNER JOIN ticket_types t ON t.guild_id = a.guild_id AND t.id = a.ticket_type_id
         WHERE a.guild_id = ?
         ORDER BY a.name ASC`,
        [interaction.guildId]
      );

      if (!rows.length) {
        return interaction.reply({ content: 'No ticket automations configured.', flags: MessageFlags.Ephemeral });
      }

      const body = rows.map((row, index) => {
        const disabledText = row.disabled_until && Number(row.disabled_until) > Date.now()
          ? ` • disabled until <t:${Math.floor(Number(row.disabled_until) / 1000)}:R>`
          : '';
        return `${index + 1}. **${row.name}** • type: **${row.type_name}** • ${row.trigger_mode} • ${formatDuration(Number(row.duration_ms) || 0)} • ${row.action_type}${disabledText}`;
      }).join('\n');

      return interaction.reply({
        content: `📋 Ticket automations\n${body}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    if (sub === 'delete_automation') {
      const name = interaction.options.getString('name', true).trim();
      const result = await query('DELETE FROM ticket_automations WHERE guild_id = ? AND LOWER(name) = LOWER(?)', [interaction.guildId, name]);
      if (!Number(result.affectedRows || 0)) {
        return interaction.reply({ content: '❌ Ticket automation not found.', flags: MessageFlags.Ephemeral });
      }

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: 'Ticket Automation Deleted',
        description: `${interaction.user} deleted automation **${name}**.`
      }).catch(() => null);

      return interaction.reply({ content: `✅ Deleted automation **${name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable_automation') {
      const name = interaction.options.getString('name', true).trim();
      const rawTime = interaction.options.getString('time', true);
      const disableMs = parseCooldown(rawTime);

      if (disableMs === null || disableMs <= 0) {
        return interaction.reply({
          content: '❌ Invalid disable time. Use format like `2d 4h`, `1h 30m`, or `15m`.',
          flags: MessageFlags.Ephemeral
        });
      }

      const disabledUntil = Date.now() + disableMs;
      const result = await query(
        `UPDATE ticket_automations
         SET disabled_until = ?, updated_at = ?
         WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
        [disabledUntil, Date.now(), interaction.guildId, name]
      );

      if (!Number(result.affectedRows || 0)) {
        return interaction.reply({ content: '❌ Ticket automation not found.', flags: MessageFlags.Ephemeral });
      }

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: 'Ticket Automation Disabled',
        description: `${interaction.user} disabled automation **${name}** for ${formatDuration(disableMs)}.`
      }).catch(() => null);

      return interaction.reply({
        content: `✅ Disabled **${name}** until <t:${Math.floor(disabledUntil / 1000)}:F>.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
