const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View bot status'),

  async execute(interaction) {

    const client = interaction.client;

    // ─── LATENCY ─────────────────────────────
    const botLatency = Date.now() - interaction.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);

    // ─── CONTAINER UPTIME (NODE BUILT-IN) ───
    const totalSeconds = Math.floor(process.uptime());

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;

    const uptime =
      `${days}d ${hours}h ${minutes}m ${seconds}s`;

    // ─── SHARD (even if not used) ───────────
    const shardId = interaction.guild?.shardId ?? 0;

    // ─── PREMIUM FLAG FROM ENV ──────────────
    const isPremium =
      process.env.PREMIUM_SERVER === 'true'
        ? '✅ Yes'
        : '❌ No';

    // ─── BUILD EMBED ────────────────────────
    const embed = new EmbedBuilder()
      .setTitle('🟢 Bot Status')
      .setColor(0x2b2d31)

      .addFields(
        {
          name: '⌛Latency',
          value: `Bot: **${botLatency}ms**\nAPI: **${apiLatency}ms**`,
          inline: true
        },
        {
          name: '⏱️Container Uptime',
          value: uptime,
          inline: true
        },
        {
          name: '🫐Shard',
          value: `#${shardId}`,
          inline: true
        },
        {
          name: '💎Premium Server',
          value: isPremium,
          inline: true
        },
        {
          name: '🔗Status Page',
          value: 'https://status.blueberrynet.uk',
          inline: false
        }
      )

      .setFooter({
        text: 'BBGames • Powered by the Blueberry Network'
      });

      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
