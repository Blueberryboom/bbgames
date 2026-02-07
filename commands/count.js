const { SlashCommandBuilder } = require('discord.js');
const pool = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('Show current count'),

  async execute(interaction) {
    const [row] = await pool.query(
      "SELECT current FROM counting WHERE guild_id = ?",
      [interaction.guildId]
    );

    await interaction.reply(
      row
        ? `🔢 Current count: **${row.current}**`
        : "❌ Counting not set up"
    );
  }

};
