const {
  SlashCommandBuilder,
  MessageFlags
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

async function canUseTags(interaction) {
  if (await checkPerms(interaction)) return true;

  const rows = await query(
    `SELECT role_id
     FROM tag_allowed_roles
     WHERE guild_id = ?`,
    [interaction.guildId]
  );

  if (!rows.length) return false;

  return rows.some(row => interaction.member.roles.cache.has(row.role_id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Create and use reusable server tags')
    .addSubcommand(sub =>
      sub
        .setName('send')
        .setDescription('Send a saved tag')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Tag name')
            .setRequired(true)
            .setMaxLength(40)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create or update a tag (admin only)')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Tag name')
            .setRequired(true)
            .setMaxLength(40)
        )
        .addStringOption(option =>
          option
            .setName('content')
            .setDescription('Tag content')
            .setRequired(true)
            .setMaxLength(1800)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('allowed_roles')
        .setDescription('Set role allowed to use /tag send (admin only)')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Allowed role for sending tags')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const rawName = interaction.options.getString('name', true).trim().toLowerCase();
      const content = interaction.options.getString('content', true).trim();

      if (!/^[a-z0-9-]{2,40}$/.test(rawName)) {
        return interaction.reply({
          content: '❌ Tag names must be 2-40 characters and use only lowercase letters, numbers, and dashes.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `INSERT INTO tags
         (guild_id, tag_name, content, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           content = VALUES(content),
           created_by = VALUES(created_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, rawName, content, interaction.user.id, Date.now()]
      );

      return interaction.reply({
        content: `✅ Saved tag \`${rawName}\`.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'allowed_roles') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const role = interaction.options.getRole('role', true);

      await query('DELETE FROM tag_allowed_roles WHERE guild_id = ?', [interaction.guildId]);
      await query(
        'INSERT INTO tag_allowed_roles (guild_id, role_id) VALUES (?, ?)',
        [interaction.guildId, role.id]
      );

      return interaction.reply({
        content: `✅ Users with ${role} can now use tag commands.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (!await canUseTags(interaction)) {
      return interaction.reply({
        content: '❌ You do not have permission to use tags in this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const rawName = interaction.options.getString('name', true).trim().toLowerCase();

    const rows = await query(
      `SELECT content
       FROM tags
       WHERE guild_id = ? AND tag_name = ?
       LIMIT 1`,
      [interaction.guildId, rawName]
    );

    if (!rows.length) {
      return interaction.reply({
        content: '❌ That tag does not exist.',
        flags: MessageFlags.Ephemeral
      });
    }

    return interaction.reply({
      content: rows[0].content
    });
  }
};
