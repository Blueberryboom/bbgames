const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pool = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_leaderboard')
    .setDescription('Show top counters'),

  async execute(interaction) {

    const rows = await pool.query(`
      SELECT *
      FROM counting_leaderboard
      WHERE guild_id = ?
      ORDER BY score DESC
      LIMIT 10
    `, [interaction.guildId]);

    if (!rows.length) {
      return interaction.reply("📭 No counting data yet!");
    }

    const embed = new EmbedBuilder()
      .setTitle("🏆 Counting Leaderboard")
      .setColor(0x5865F2);

    let desc = "";

    rows.forEach((r, i) => {

      const total = r.score + r.fails;
      const rate =
        total === 0
          ? 100
          : Math.round((r.score / total) * 100);

      desc +=
`**#${i + 1}** <@${r.user_id}>
➤ Score: **${r.score}**
➤ Fails: **${r.fails}**
➤ Success: **${rate}%**

`;
    });

    embed.setDescription(desc);

    await interaction.reply({ embeds: [embed] });
  }
};
