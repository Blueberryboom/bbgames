const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_reset')
    .setDescription('Reset count for this guild'),

  async execute(interaction) {
    if (!await checkPerms(interaction))
      return interaction.reply({ content: "❌ No permission", ephemeral: true });

    await pool.query(
      "DELETE FROM counting WHERE guild_id = ?",
      [interaction.guildId]
    );

    await interaction.reply("💥 Counting data reset!");
  }
  
};
