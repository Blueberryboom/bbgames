const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help categories and quick actions'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Help')
      .setDescription('Please select a category below!');

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

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('help_run_about').setLabel('/about').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('help_run_status').setLabel('/status').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('help_run_donate').setLabel('/donate').setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ embeds: [embed], components: [dropdown, buttons] });
  }
};
