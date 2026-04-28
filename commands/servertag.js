const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { syncGuildServerTagRewards } = require('../utils/serverTagRewardManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('servertag')
    .setDescription('Manage server-tag role rewards')
    .addSubcommand(sub =>
      sub
        .setName('rewards')
        .setDescription('Enable rewards role for users with the server tag')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to sync every 5 minutes')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable server-tag reward syncing')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'disable') {
      await query(
        `UPDATE servertag_reward_settings
         SET enabled = 0, updated_at = ?
         WHERE guild_id = ?`,
        [Date.now(), interaction.guildId]
      );

      return interaction.reply({
        content: '✅ Server-tag rewards disabled.',
        flags: MessageFlags.Ephemeral
      });
    }

    const role = interaction.options.getRole('role', true);

    await query(
      `INSERT INTO servertag_reward_settings (guild_id, role_id, enabled, updated_at)
       VALUES (?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         role_id = VALUES(role_id),
         enabled = 1,
         updated_at = VALUES(updated_at)`,
      [interaction.guildId, role.id, Date.now()]
    );

    await syncGuildServerTagRewards(interaction.guild).catch(() => null);

    return interaction.reply({
      content: `✅ Server-tag rewards enabled. Role ${role} will sync every 5 minutes.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
