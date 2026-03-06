const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('systemmsgs')
    .setDescription('Manage system announcements for counting')
    .addStringOption(o =>
      o.setName('state')
        .setDescription('Turn announcements on or off')
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' }
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: '❌ Server only command.', flags: MessageFlags.Ephemeral });
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
    }

    const state = interaction.options.getString('state', true);
    const enabled = state === 'on' ? 1 : 0;

    await pool.query(
      `INSERT INTO counting (guild_id, announcements_enabled)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE announcements_enabled = VALUES(announcements_enabled)`,
      [interaction.guildId, enabled]
    );

    const text = enabled ? 'enabled' : 'disabled';
    return interaction.reply({
      content: `✅ System announcements are now **${text}** for this server.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
