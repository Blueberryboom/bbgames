const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin'),

  async execute(interaction) {

    const result = Math.random() < 0.5 ? "Heads" : "Tails";

    const embed = new EmbedBuilder()
      .setTitle("🪙 Coin Flip")
      .setDescription(`The coin landed on **${result}**!`)
      .setColor(result === "Heads" ? 0x3498DB : 0xE67E22)
      .setFooter({ text: `Flipped by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
