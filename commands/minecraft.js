const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const RECOMMENDED_SERVERS = [
  {
    host: 'play.hypixel.net',
    location: 'North America / Europe',
    players: '60,000+',
    description: 'Huge minigame network with SkyBlock, BedWars, and more.'
  },
  {
    host: 'play.cubecraft.net',
    location: 'Europe / North America',
    players: '8,000+',
    description: 'Fast-paced minigames and seasonal events.'
  },
  {
    host: 'mp.mineplex.com',
    location: 'North America',
    players: '2,000+',
    description: 'Classic minigames and casual arcade modes.'
  },
  {
    host: 'play.manacube.com',
    location: 'Europe',
    players: '3,000+',
    description: 'Popular parkour, survival, and skyblock community.'
  },
  {
    host: 'org.mccentral.org',
    location: 'North America / Europe',
    players: '1,000+',
    description: 'Faction and prison-focused server network.'
  }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minecraft')
    .setDescription('Find servers and check Minecraft server status')
    .addSubcommand(sub =>
      sub.setName('find').setDescription('Show sponsored servers to try')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check if a Minecraft server is online')
        .addStringOption(o =>
          o.setName('server')
            .setDescription('Server domain or IP')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'find') {
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🧭 Sponsored Minecraft Servers')
        .setDescription(
          RECOMMENDED_SERVERS.map((server, i) =>
            `**${i + 1}. \`${server.host}\`**\n` +
            `• Description: ${server.description}\n` +
            `• Location: ${server.location}\n` +
            `• Players: ${server.players}`
          ).join('\n\n')
        );

      return interaction.reply({ embeds: [embed] });
    }

    const server = interaction.options.getString('server').trim();

    try {
      const res = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(server)}`);
      if (!res.ok) {
        return interaction.reply({ content: '❌ Could not fetch server status right now.', flags: MessageFlags.Ephemeral });
      }

      const data = await res.json();

      const online = Boolean(data.online);
      const playersOnline = data.players?.online ?? 0;
      const playersMax = data.players?.max ?? 0;
      const motd = Array.isArray(data.motd?.clean) ? data.motd.clean.join(' ') : (data.motd?.clean || 'No MOTD');

      const embed = new EmbedBuilder()
        .setColor(online ? 0x57F287 : 0xED4245)
        .setTitle(`Minecraft Status • ${server}`)
        .addFields(
          { name: 'Status', value: online ? '🟢 Online' : '🔴 Offline', inline: true },
          { name: 'Players', value: `${playersOnline}/${playersMax}`, inline: true },
          { name: 'MOTD', value: String(motd).slice(0, 1024), inline: false }
        );

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch {
      return interaction.reply({ content: '❌ Could not check that server. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }
};
