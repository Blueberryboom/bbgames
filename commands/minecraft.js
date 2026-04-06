const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minecraft')
    .setDescription('Check Minecraft server status')
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
    if (sub !== 'status') return;

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
