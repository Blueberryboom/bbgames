const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('Reroll a giveaway')
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

    // ─── VERIFY GIVEAWAY + SERVER ───────────
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

    if (!giveaway.ended) {
      return interaction.reply({
        content: "⚠️ You can only reroll giveaways after they have ended!",
        ephemeral: true
      });
    }

    // ─── LOAD ENTRIES ───────────────────────
    const entries = await pool.query(
      "SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?",
      [id]
    );

    if (!entries.length) {
      return interaction.reply({
        content: "❌ No entries in this giveaway!",
        ephemeral: true
      });
    }

    // ─── PICK RANDOM WINNER ─────────────────
    const winner =
      entries[Math.floor(Math.random() * entries.length)];

    await interaction.reply(
      `🎉 New winner: <@${winner.user_id}>`
    );
  }
};
