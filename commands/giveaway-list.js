const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

function toNumber(val) {
  return typeof val === 'bigint' ? Number(val) : val;
}

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
      [interaction.guildId]
    );

    if (rows.length === 0) {
      return interaction.reply({
        content: "❌ No active giveaways!",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🎉 Active Giveaways")
      .setColor(0x5865F2)
      .setDescription(
        "Use `/giveaway-end id:<ID>` to close one"
      );

    for (const g of rows) {

      const endTime = Math.floor(
        toNumber(g.end_time) / 1000
      );

      const jump =
        `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}`;

      embed.addFields({
        name: `🎁 ${g.prize}`,
        value:
`🆔 **${g.id}**
👑 Winners: **${g.winners}**
⏱ Ends: <t:${endTime}:R>
🔗 [Jump to message](${jump})`,
        inline: false
      });
    }

    await interaction.reply({
      embeds: [embed]
    });
  }
};
