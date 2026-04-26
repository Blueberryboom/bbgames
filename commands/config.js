const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ComponentType
} = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { clearGuildData } = require('../utils/guildCleanup');
const { LOG_EVENT_KEYS, logGuildEvent } = require('../utils/guildLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure permissions and system messages')
    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription('Open the config menu')
    )
    .addSubcommand(sub =>
      sub
        .setName('bot_manager_role')
        .setDescription('Set the bot manager role for protected commands')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role allowed to manage all protected bot commands')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('giveaway_admin_role')
        .setDescription('Set the giveaway admin role (giveaway command only)')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role allowed to manage giveaways only')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('staff_role')
        .setDescription('Set the staff role for moderation actions (tickets/suggestions)')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role allowed for staff-only actions')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('system_messages')
        .setDescription('Enable or disable system announcements for counting')
        .addStringOption(o =>
          o.setName('state')
            .setDescription('Turn system messages on or off')
            .addChoices(
              { name: 'On', value: 'on' },
              { name: 'Off', value: 'off' }
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('delete_data')
        .setDescription('Delete all bot data for this server (Administrator only)')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'delete_data') {
      return handleDeleteData(interaction);
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'bot_manager_role') {
      const role = interaction.options.getRole('role', true);

      await pool.query('DELETE FROM admin_roles WHERE guild_id = ?', [interaction.guildId]);
      await pool.query('INSERT INTO admin_roles (guild_id, role_id) VALUES (?, ?)', [interaction.guildId, role.id]);

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: '⚙️ Configuration Updated',
        description: `/config bot_manager_role used by <@${interaction.user.id}>.`,
        fields: [{ name: 'Bot Manager Role', value: `<@&${role.id}>` }]
      });

      return interaction.reply({
        content: `<:checkmark:1495875811792781332> Admin role set to ${role}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'giveaway_admin_role') {
      const role = interaction.options.getRole('role', true);

      await pool.query('DELETE FROM giveaway_admin_roles WHERE guild_id = ?', [interaction.guildId]);
      await pool.query('INSERT INTO giveaway_admin_roles (guild_id, role_id) VALUES (?, ?)', [interaction.guildId, role.id]);

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: '⚙️ Configuration Updated',
        description: `/config giveaway_admin_role used by <@${interaction.user.id}>.`,
        fields: [{ name: 'Giveaway Admin Role', value: `<@&${role.id}>` }]
      });

      return interaction.reply({
        content: `<:checkmark:1495875811792781332> Giveaway admin role set to ${role}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'staff_role') {
      const role = interaction.options.getRole('role', true);

      await pool.query('DELETE FROM staff_roles WHERE guild_id = ?', [interaction.guildId]);
      await pool.query('INSERT INTO staff_roles (guild_id, role_id) VALUES (?, ?)', [interaction.guildId, role.id]);

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: '⚙️ Configuration Updated',
        description: `/config staff_role used by <@${interaction.user.id}>.`,
        fields: [{ name: 'Staff Role', value: `<@&${role.id}>` }]
      });

      return interaction.reply({
        content: `<:checkmark:1495875811792781332> Staff role set to ${role}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'system_messages') {
      const enabled = interaction.options.getString('state', true) === 'on' ? 1 : 0;

      await pool.query(
        `INSERT INTO counting (guild_id, announcements_enabled)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE announcements_enabled = VALUES(announcements_enabled)`,
        [interaction.guildId, enabled]
      );

      await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.configuration_changes, {
        title: '⚙️ Configuration Updated',
        description: `/config system_messages used by <@${interaction.user.id}>.`,
        fields: [
          { name: 'System Messages', value: enabled ? 'Enabled' : 'Disabled' }
        ]
      });

      return interaction.reply({
        content: `<:checkmark:1495875811792781332> System messages are now ${enabled ? 'enabled' : 'disabled'}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const roleRows = await pool.query('SELECT role_id FROM admin_roles WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const giveawayRows = await pool.query('SELECT role_id FROM giveaway_admin_roles WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const staffRows = await pool.query('SELECT role_id FROM staff_roles WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const countRows = await pool.query('SELECT announcements_enabled FROM counting WHERE guild_id = ? LIMIT 1', [interaction.guildId]);

    const roleText = roleRows[0]?.role_id ? `<@&${roleRows[0].role_id}>` : 'Not set';
    const giveawayRoleText = giveawayRows[0]?.role_id ? `<@&${giveawayRows[0].role_id}>` : 'Not set';
    const staffRoleText = staffRows[0]?.role_id ? `<@&${staffRows[0].role_id}>` : 'Not set';
    const msgsEnabled = Number(countRows[0]?.announcements_enabled ?? 1) === 1;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Bot Configuration')
      .setDescription('Select a menu below.')
      .addFields(
        { name: 'Permissions', value: `Bot manager role: ${roleText}\nGiveaway admin role: ${giveawayRoleText}` },
        { name: 'Staff Access', value: `Staff role: ${staffRoleText}` },
        { name: 'Messages', value: `System messages: ${msgsEnabled ? 'On' : 'Off'}` }
      );

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('config_menu')
        .setPlaceholder('Select config menu')
        .addOptions(
          { label: 'permissions', value: 'permissions', description: 'Manage admin role access' },
          { label: 'messages', value: 'messages', description: 'Manage system message settings' }
        )
    );

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }
};

async function handleDeleteData(interaction) {
  const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdministrator) {
    return interaction.reply({
      content: '<:warning:1496193692099285255> Only members with the **Administrator** permission can use `/config delete_data`.',
      flags: MessageFlags.Ephemeral
    });
  }

  const levelingCountRows = await pool.query(
    `SELECT COUNT(*) AS total
     FROM leveling_users
     WHERE guild_id = ?`,
    [interaction.guildId]
  );
  const levelingMembers = Number(levelingCountRows[0]?.total || 0);

  const approvalRows = await pool.query(
    `SELECT approved_at
     FROM guild_data_deletion_approvals
     WHERE guild_id = ?`,
    [interaction.guildId]
  );
  const hasOwnerApproval = approvalRows.length > 0;

  if (levelingMembers > 10000 && !hasOwnerApproval) {
    return interaction.reply({
      content: '<:warning:1496193692099285255> This server has over **10,000** users in the leveling system. Please submit a support ticket in your Discord server first, then have the bot owner run `/owner approve_data_deletion` for this server.',
      flags: MessageFlags.Ephemeral
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`config_delete_data_confirm:${interaction.guildId}`)
      .setLabel('Confirm Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`config_delete_data_cancel:${interaction.guildId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: '⚠️ This will permanently delete all bot data for this server. Are you sure?',
    components: [row],
    flags: MessageFlags.Ephemeral
  });

  const replyMessage = await interaction.fetchReply();
  const collector = replyMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30_000
  });

  collector.on('collect', async buttonInteraction => {
    if (buttonInteraction.user.id !== interaction.user.id) {
      return buttonInteraction.reply({ content: '<:warning:1496193692099285255> This confirmation is not for you.', flags: MessageFlags.Ephemeral });
    }

    if (buttonInteraction.customId.startsWith('config_delete_data_cancel:')) {
      collector.stop('cancelled');
      return buttonInteraction.update({
        content: '<:checkmark:1495875811792781332> Data deletion cancelled.',
        components: []
      });
    }

    await logGuildEvent(interaction.client, interaction.guildId, LOG_EVENT_KEYS.data_deletions, {
      title: '🗑️ Server Data Deleted',
      description: `All bot data for this server was deleted by <@${interaction.user.id}>.`,
      fields: [
        { name: 'Server ID', value: interaction.guildId, inline: true },
        { name: 'Leveling Users Before Deletion', value: levelingMembers.toLocaleString(), inline: true }
      ],
      color: 0xED4245
    });

    await clearGuildData(interaction.guildId);
    await pool.query('DELETE FROM guild_data_deletion_approvals WHERE guild_id = ?', [interaction.guildId]);

    collector.stop('confirmed');
    return buttonInteraction.update({
      content: '<:checkmark:1495875811792781332> All bot data for this server has been deleted.',
      components: []
    });
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      await interaction.editReply({
        content: '⌛ Confirmation expired. Run `/config delete_data` again if you still want to proceed.',
        components: []
      }).catch(() => null);
    }
  });
}
