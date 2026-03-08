const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const SUPPORT_URL = 'https://www.buymeacoffee.com/blueberryboom';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help categories and command list'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Help')
      .setDescription('Please select a category below!')
      .addFields(
        {
          name: 'Command | Description',
          value: [
            '`/counting_channel` | Set counting channel',
            '`/count` | Show current count',
            '`/giveaway` | Giveaway management tools',
            '`/youtube` | YouTube notifications',
            '`/minecraft` | Find/status Minecraft servers',
            '`/config` | Permissions + message settings',
            '`/about` | About the bot',
            '`/status` | Bot health status',
            '`/donate` | Support development'
          ].join('\n')
        }
      );

    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Select a module')
        .addOptions(
          { label: 'Counting', value: 'counting' },
          { label: 'Giveaways', value: 'giveaways' },
          { label: 'Fun', value: 'fun' },
          { label: 'YouTube', value: 'youtube' },
          { label: 'misc', value: 'misc' }
        )
    );

    const supportButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Support Us')
        .setStyle(ButtonStyle.Link)
        .setURL(SUPPORT_URL)
    );

    await interaction.reply({ embeds: [embed], components: [dropdown, supportButton] });
  }
};
