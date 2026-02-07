const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_removechannel')
    .setDescription('Stop counting (keeps number)'),

  async execute(interaction) {
    if (!await checkPerms(interaction))
      return interaction.reply({ content: "❌ No permission", ephemeral: true });

    await pool.query(
      "UPDATE counting SET channel_id = NULL WHERE guild_id = ?",
      [interaction.guildId]
    );

    await interaction.reply("🛑 Counting channel removed (count saved)");
  }
  
};
