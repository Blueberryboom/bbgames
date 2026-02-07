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

    // ─── VERIFY GIVEAWAY BELONGS TO THIS SERVER ─────
    const rows = await pool.query(
      "SELECT * FROM giveaways WHERE id = ? AND guild_id = ?",
      [id, interaction.guildId]
    );

    const giveaway = rows[0];

    if (!giveaway) {
      return interaction.reply({
        content: "❌ Giveaway not found in this server!",
        ephemeral: true
      });
    }

    if (giveaway.ended) {
      return interaction.reply({
        content: "⚠️ This giveaway has already ended!",
        ephemeral: true
      });
    }

    // ─── END IT SAFELY ───────────────────────
    await pool.query(
      "UPDATE giveaways SET ended = 1 WHERE id = ? AND guild_id = ?",
      [id, interaction.guildId]
    );

    await interaction.reply("✅ Giveaway ended successfully!");
  }
};
