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
      .setDescription(`
Hello! We would greatly appreciate it if you could donate, every donation **helps us out massively**! Your donation will be used to:

> - Keep this bot online and in active development :D
> - Fund the Blueberry Network https://blueberrynet.uk
> - Help us run giveaways and events in the Discord!
> - Other development stuff

Our goal is **£10 per month** in donations! Help us reach it below!

We also offer a premium version of BBGames, it can be purchased from our Buy Me A Coffee page (Blueberry Premium). 
Please note that to use BBGames Premium you must join our discord server!
      `);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Buy Me A Coffee')
        .setStyle(ButtonStyle.Link)
        .setURL(DONATE_URL),
      new ButtonBuilder()
        .setLabel('Our Discord')
        .setStyle(ButtonStyle.Link)
        .setURL('https://blueberrynet.uk/discord')
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};
