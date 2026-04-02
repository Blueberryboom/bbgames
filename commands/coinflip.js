const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { trackAchievementEvent } = require('../utils/achievementManager');

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

    if (result === 'Tails') {
      await trackAchievementEvent({
        userId: interaction.user.id,
        event: 'coinflip_tails',
        context: {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          channel: interaction.channel,
          userMention: `${interaction.user}`
        }
      });
    }
  }
};
