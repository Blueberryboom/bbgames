const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const RECOMMENDED_SERVERS = [
  'play.hypixel.net',
  'play.cubecraft.net',
  'mp.mineplex.com',
  'play.manacube.com',
  'org.mccentral.org'
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
        .setDescription(RECOMMENDED_SERVERS.map((server, i) => `${i + 1}. \`${server}\``).join('\n'));

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
      const version = Array.isArray(data.version) ? data.version.join(', ') : (data.version || 'Unknown');
      const motd = Array.isArray(data.motd?.clean) ? data.motd.clean.join(' ') : (data.motd?.clean || 'No MOTD');

      const embed = new EmbedBuilder()
        .setColor(online ? 0x57F287 : 0xED4245)
        .setTitle(`Minecraft Status • ${server}`)
        .addFields(
          { name: 'Status', value: online ? '🟢 Online' : '🔴 Offline', inline: true },
          { name: 'Players', value: `${playersOnline}/${playersMax}`, inline: true },
          { name: 'Version', value: String(version), inline: true },
          { name: 'MOTD', value: String(motd).slice(0, 1024), inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    } catch {
      return interaction.reply({ content: '❌ Could not check that server. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }
};
