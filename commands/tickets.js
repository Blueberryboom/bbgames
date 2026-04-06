const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Manage ticket types')
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
          opt.setName('description')
            .setDescription('Optional short menu description (max 60 chars)')
            .setRequired(false)
            .setMaxLength(60)
        )
        .addStringOption(opt =>
          opt.setName('ticket_welcome_open_message')
            .setDescription('Embed description shown when ticket opens')
            .setRequired(true)
            .setMaxLength(1800)
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
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to manage ticket types.',
        flags: MessageFlags.Ephemeral
      });
    }

    const name = interaction.options.getString('name', true).trim();
    const prefix = interaction.options.getString('prefix', true).trim();
    const shortDescription = interaction.options.getString('description')?.trim() || null;
    const welcomeMessage = interaction.options.getString('ticket_welcome_open_message', true).trim();

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

    return interaction.reply({
      content: `✅ Created ticket type **${name}** with ${staffRoleIds.length} staff role(s).`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }
};
