const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-list')
    .setDescription('List active giveaways'),

  async execute(interaction) {

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: "❌ You are not a bot admin!",
        ephemeral: true
      });
    }

    const rows = await pool.query(
      "SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0",
      [interaction.guild.id]
    );

    if (rows.length === 0)
      return interaction.reply("❌ No active giveaways!");

    const embed = new EmbedBuilder()
      .setTitle("🎉 Active Giveaways")
      .setColor(0x5865F2);

    for (const g of rows) {
      embed.addFields({
        name: g.prize,
        value:
`🆔 ${g.id}
👑 Winners: ${g.winners}
⏱ Ends: <t:${Math.floor(g.end_time / 1000)}:R>`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  }
};
