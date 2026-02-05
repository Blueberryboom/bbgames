const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const package = require('../package.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Information about the bot'),

  async execute(interaction) {

    const embed = new EmbedBuilder()
      .setTitle('🎉BBGames')
      .setColor(0x2b2d31)
      .setDescription('A cool games bot that serves as a replacement for your 200 game bots!')

      .addFields(
        {
          name: '📦Version',
          value: package.version,
          inline: true
        },
        {
          name: '👋Developer',
          value: '@Blueberryboom :D',
          inline: true
        },
        {
          name: '🏡Server Count',
          value: `${interaction.client.guilds.cache.size}`,
          inline: true
        },
        {
          name: '😭Discord Server',
          value: '[Join our Discord](https://discord.gg/sKV2ze9HQv)',
          inline: false
        },
        {
          name: '🔗Status Page',
          value: 'https://status.blueberrynet.uk',
          inline: false
        }
      )

      .setFooter({
        text: 'BBGames • Powered by the Blueberry Network'
      });

    await interaction.reply({ embeds: [embed] });
  }
};
