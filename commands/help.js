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
    .setDescription('Show help categories, permissions, and command list'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('BBGames Help')
      .setDescription('Select a category below for focused help.\n\n**Quick commands:** `/help`, `/status`, `/about`, `/support`')
      .addFields(
        {
          name: 'Setup Essentials',
          value: [
            '`/config panel` • Open settings overview',
            '`/config bot_manager_role` • Assign full bot-manager role',
            '`/count channel` • Set counting channel',
            '`/youtube add` • Add upload notifications',
            '`/sticky create` • Set channel sticky message'
          ].join('\n')
        },
        {
          name: 'Fun & Utilities',
          value: [
            '`/rps` • Rock paper scissors vs bot or users',
            '`/dadjoke` • Random dad joke',
            '`/coinflip` • Heads or tails',
            '`/minecraft` • Query server info/status'
          ].join('\n')
        }
      )
      .setFooter({ text: 'Tip: Bot owner can run protected commands globally.' });

    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Select a module')
        .addOptions(
          { label: 'Counting', value: 'counting' },
          { label: 'Giveaways', value: 'giveaways' },
          { label: 'Fun', value: 'fun' },
          { label: 'YouTube', value: 'youtube' },
          { label: 'Misc', value: 'misc' }
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
