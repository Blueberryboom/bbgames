const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');

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

    const id = interaction.options.getString('id');

    const entries = await pool.query(
      "SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?",
      [id]
    );

    if (entries.length === 0)
      return interaction.reply("❌ No entries!");

    const winner =
      entries[Math.floor(Math.random() * entries.length)];

    await interaction.reply(
      `🎉 New winner: <@${winner.user_id}>`
    );
  }
};
