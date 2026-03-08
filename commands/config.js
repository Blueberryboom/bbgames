const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

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
        .setName('admin_role')
        .setDescription('Set the admin role for bot management commands')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role allowed to manage sensitive bot commands')
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
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured admin role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'admin_role') {
      const role = interaction.options.getRole('role', true);

      await pool.query('DELETE FROM admin_roles WHERE guild_id = ?', [interaction.guildId]);
      await pool.query('INSERT INTO admin_roles (guild_id, role_id) VALUES (?, ?)', [interaction.guildId, role.id]);

      return interaction.reply({
        content: `✅ Admin role set to ${role}.`,
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

      return interaction.reply({
        content: `✅ System messages are now ${enabled ? 'enabled' : 'disabled'}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const roleRows = await pool.query('SELECT role_id FROM admin_roles WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const countRows = await pool.query('SELECT announcements_enabled FROM counting WHERE guild_id = ? LIMIT 1', [interaction.guildId]);

    const roleText = roleRows[0]?.role_id ? `<@&${roleRows[0].role_id}>` : 'Not set';
    const msgsEnabled = Number(countRows[0]?.announcements_enabled ?? 1) === 1;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Bot Configuration')
      .setDescription('Select a menu below.')
      .addFields(
        { name: 'Permissions', value: `Admin role: ${roleText}` },
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
