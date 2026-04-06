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
            '`/logs channel` • Set bot activity log channel',
            '`/logs choose` • Choose activity types to log',
            '`/count channel` • Set counting channel',
            '`/youtube add` • Add upload notifications',
            '`/sticky create` • Set channel sticky message',
            '`/welcome config` • Configure member join messages',
            '`/leave config` • Configure member leave messages',
            '`/boostmsg config` • Configure server boost messages'
          ].join('\n')
        },
        {
          name: 'Ticket System (Updated)',
          value: [
            '`/ticket config` • Configure category, transcript channel, limits, claiming',
            '`/tickets create_type` • Create a ticket type',
            '`/ticket delete_type` • Delete a ticket type (no open tickets)',
            '`/ticket panel` • Send panel + optional live workload block',
            '`/ticket creation_cooldown` • Set how often users can open tickets',
            '`/ticket close_request` • Assigned ticket staff can request owner close',
            '`/ticket reset` • Delete all ticket channels + wipe all ticket data',
            'Transcripts are now posted as plaintext messages, not files.',
            'Sensitive ticket setup commands require Admin, Bot Manager, or bot owner.'
          ].join('\n')
        },
        {
          name: 'Fun & Utilities',
          value: [
            '`/rps` • Rock paper scissors vs bot or users',
            '`/dadjoke` • Random dad joke',
            '`/coinflip` • Heads or tails',
            '`/minecraft status` • Check Minecraft server status',
            '`/tag send` • Send a saved tag',
            '`/onewordstory view` • View story progress',
            '`/starboard configure` • Auto-post popular messages',
            '`/servertag rewards` • Sync role by server tag'
          ].join('\n')
        },
        {
          name: 'All Commands',
          value: [
            '`/about`, `/achievements`, `/afk`, `/afk_leaderboard`, `/automsg`',
            '`/birthday`, `/boostmsg`, `/coinflip`, `/config`, `/count`, `/dadjoke`',
            '`/dice`, `/donate`, `/giveaway`, `/help`, `/leave`, `/level`, `/leveling`',
            '`/logs`, `/minecraft`, `/onewordstory`, `/owner`, `/premium`, `/purge`, `/rps`, `/say`',
            '`/servertag`, `/starboard`, `/status`, `/sticky`, `/support`, `/tag`, `/tags`, `/ticket`, `/tickets`, `/tictactoe`, `/variableslowmode`, `/welcome`, `/youtube`'
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
