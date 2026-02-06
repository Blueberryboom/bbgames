const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-end')
    .setDescription('End a giveaway')
    .addStringOption(o =>
      o.setName('id')
       .setDescription('Giveaway ID')
       .setRequired(true)
    ),

  async execute(interaction) {

    // ─── PERMISSION CHECK ───────────────────
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: "❌ You are not a bot admin!",
        ephemeral: true
      });
    }

    const id = interaction.options.getString('id');

    await pool.query(
      "UPDATE giveaways SET ended = 1 WHERE id = ?",
      [id]
    );

    await interaction.reply("✅ Giveaway ended!");
  }
};
