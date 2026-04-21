const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Manage automatic join roles')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Add an autorole')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to give on join').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List configured autoroles'))
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete an autorole')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true))
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or configured bot manager role.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await query('SELECT role_id FROM autoroles WHERE guild_id = ? ORDER BY created_at ASC', [interaction.guildId]);
      if (!rows.length) {
        return interaction.reply({ content: 'ℹ️ No autoroles configured for this server.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `✅ Configured autoroles (${rows.length}):\n${rows.map(r => `• <@&${r.role_id}> (\`${r.role_id}\`)`).join('\n')}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    const role = interaction.options.getRole('role', true);

    if (sub === 'create') {
      if (role.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Autorole cannot be a role with Administrator permissions.',
          flags: MessageFlags.Ephemeral
        });
      }

      const maxRoles = await getPremiumLimit(interaction.client, interaction.guildId, 3, 6);
      const rows = await query('SELECT role_id FROM autoroles WHERE guild_id = ?', [interaction.guildId]);
      if (rows.length >= maxRoles) {
        return interaction.reply({
          content: `❌ You can only configure up to ${maxRoles} autoroles on this server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `INSERT IGNORE INTO autoroles (guild_id, role_id, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
        [interaction.guildId, role.id, interaction.user.id, Date.now()]
      );

      return interaction.reply({ content: `✅ Added ${role} as an autorole for new members.`, flags: MessageFlags.Ephemeral });
    }

    await query('DELETE FROM autoroles WHERE guild_id = ? AND role_id = ?', [interaction.guildId, role.id]);
    return interaction.reply({ content: `✅ Removed ${role} from autoroles.`, flags: MessageFlags.Ephemeral });
  }
};
