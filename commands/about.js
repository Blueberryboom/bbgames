const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const package = require('../package.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Information about the bot'),

  async execute(interaction) {

    const client = interaction.client;

    let totalMembers = 0;
    let serverCount = 0;

    // ─── SHARD AWARE COUNTING ───────────────────────
    if (client.shard) {

      // Guild count from all shards
      const guildCounts = await client.shard.fetchClientValues(
        'guilds.cache.size'
      );

      serverCount = guildCounts.reduce((a, b) => a + b, 0);

      // Member count from all shards
      const memberCounts = await client.shard.broadcastEval(c =>
        c.guilds.cache.reduce(
          (acc, g) => acc + (g.memberCount || 0),
          0
        )
      );

      totalMembers = memberCounts.reduce((a, b) => a + b, 0);

    } else {

      // Fallback if not sharded
      serverCount = client.guilds.cache.size;

      totalMembers = client.guilds.cache.reduce(
        (acc, guild) => acc + (guild.memberCount || 0),
        0
      );
    }

    // Auto create invite link
    const inviteUrl =
      `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=4503995570056272&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setTitle('🎉 BBGames')
      .setColor(0x5865F2)

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
          value: `**${serverCount}** (${totalMembers} members)`,
          inline: true
        }
      )

      .setFooter({
        text: 'BBGames • Powered by the Blueberry Network'
      })
      .setTimestamp();

// ─── BUTTONS ─────────────────────────────
    
const buttons = new ActionRowBuilder()
  .addComponents(

    new ButtonBuilder()
      .setLabel('Invite Bot')
      .setEmoji('🤖')
      .setStyle(ButtonStyle.Link)
      .setURL(inviteUrl),

    new ButtonBuilder()
      .setLabel('My Discord')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Link)
      .setURL('https://discord.gg/sKV2ze9HQv'),
    
    new ButtonBuilder()
      .setLabel('Status Page')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Link)
      .setURL('https://status.blueberrynet.uk')
  );


    await interaction.reply({
      embeds: [embed],
      components: [buttons]
    });
  }
};
