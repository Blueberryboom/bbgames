const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adminset')
    .setDescription('Set event admin role')
    .addRoleOption(o =>
      o.setName('role')
       .setDescription('Role that can manage the bot')
       .setRequired(true)
    ),

  async execute(interaction) {

    if (!interaction.member.permissions.has("Administrator"))
      return interaction.reply({
        content: "❌ Admin only!",
        ephemeral: true
      });

    const role = interaction.options.getRole('role');

    await pool.query(
      "REPLACE INTO event_admin_roles VALUES (?, ?)",
      [interaction.guild.id, role.id]
    );

    await interaction.reply(
      `✅ ${role} can now manage giveaways!`
    );
  }
};
