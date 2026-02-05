const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const package = require('../package.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Information about the bot'),

  async execute(interaction) {

    const client = interaction.client;

    // Count total members across all servers
    const totalMembers = client.guilds.cache.reduce(
      (acc, guild) => acc + (guild.memberCount || 0),
      0
    );

    const serverCount = client.guilds.cache.size;

    // Auto create invite link using your CLIENT_ID
    const inviteUrl =
      `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=4503995570056272&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setTitle('🎉 BBGames')
      .setColor(0x5865F2) // DISCORD BURPLE 💜

      .setDescription(
        'A powerful games bot designed to replace your 200 different game bots with one!'
      )

      .addFields(
        {
          name: '📦 Version',
          value: package.version,
          inline: true
        },
        {
          name: '👋 Developer',
          value: '@Blueberryboom :D',
          inline: true
        },
        {
          name: '🏡 Servers',
          value: `${serverCount} (${totalMembers} members)`,
          inline: true
        },
        {
          name: '🔗 Useful Links',
          value:
            '[Status Page](https://status.blueberrynet.uk)',
          inline: false
        }
      )

      .setFooter({
        text: 'BBGames • Powered by the Blueberry Network'
      })
      .setTimestamp();

    // BUTTONS ─────────────────────────────

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Invite Bot')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl),

        new ButtonBuilder()
          .setLabel('My Discord')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/sKV2ze9HQv')
      );

    await interaction.reply({
      embeds: [embed],
      components: [buttons]
 
    });
  }
};
