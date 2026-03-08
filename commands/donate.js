const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const DONATE_URL = 'https://www.buymeacoffee.com/blueberryboom';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('donate')
    .setDescription('Support the bot development'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle('💛 Support BBGames')
      .setDescription('Your donation will help us keep BBGames online, improve features faster, and bring more fun updates to your server. Every coffee directly supports development, hosting, and future modules.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Buy Me A Coffee')
        .setStyle(ButtonStyle.Link)
        .setURL(DONATE_URL)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};
