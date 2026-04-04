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
            '`/minecraft` • Query server info/status',
            '`/tag send` • Send a saved tag',
            '`/onewordstory view` • View story progress',
            '`/starboard configure` • Auto-post popular messages',
            '`/servertag rewards` • Sync role by server tag'
          ].join('\n')
        },
        {
          name: 'All Commands',
          value: [
            '`/help`, `/about`, `/status`, `/support`, `/donate`',
            '`/config`, `/count`, `/giveaway`, `/youtube`, `/sticky`, `/automsg`',
            '`/leveling`, `/level`, `/birthday`, `/afk`, `/afk_leaderboard`',
            '`/variableslowmode`, `/welcome`, `/premium`, `/owner`',
            '`/tag`, `/onewordstory`, `/starboard`, `/servertag`, `/coinflip`, `/dadjoke`, `/dice`, `/minecraft`, `/rps`, `/tictactoe`'
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
          { label: 'Tags', value: 'tags' },
          { label: 'One Word Story', value: 'onewordstory' },
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
