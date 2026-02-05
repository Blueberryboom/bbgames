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

    // ─── CONTAINER UPTIME ────────────────────
    const totalSeconds = Math.floor(process.uptime());

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;

    const uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`;

    // ─── COUNTS ──────────────────────────────
    const serverCount = client.guilds.cache.size;

    const memberCount = client.guilds.cache.reduce(
      (acc, guild) => acc + (guild.memberCount || 0),
      0
    );

    // ─── SHARD ───────────────────────────────
    const shardId = interaction.guild?.shardId ?? 0;

    // ─── PREMIUM TIER FROM ENV ───────────────
    const premiumRaw = String(process.env.PREMIUM_SERVER || '').toLowerCase();

    let premiumDisplay = '❌ Standard Bot';

    if (premiumRaw === 'true_1' || premiumRaw === 'true') {
      premiumDisplay = '💎 Tier 1';
    }
    else if (premiumRaw === 'true_2') {
      premiumDisplay = '🎉 Tier 2';
    }
    else if (premiumRaw === 'true_3') {
      premiumDisplay = '✨ Tier 3 - Customized Profile';
    }

    // ─── BUILD EMBED ─────────────────────────
    const embed = new EmbedBuilder()
      .setTitle('🟢 Bot Status')
      .setColor(0x57F287) // GREEN 💚

      .addFields(
        {
          name: '⌛ Latency',
          value: `Bot: **${botLatency}ms**\nAPI: **${apiLatency}ms**`,
          inline: true
        },
        {
          name: '⏱️ Uptime',
          value: uptime,
          inline: true
        },
        {
          name: '🌍 Servers',
          value: `**${serverCount}** (${memberCount} members)`,
          inline: true
        },

        {
          name: '🫐 Shard',
          value: `Shard **${shardId}**`,
          inline: true
        },

        {
          name: '💎 Premium Tier',
          value: premiumDisplay,
          inline: true
        },

        {
          name: '🔗 Status Page',
          value: 'https://status.blueberrynet.uk',
          inline: false
        }
      )

      .setFooter({
        text: 'BBGames • Powered by the Blueberry Network'
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed]
    });
  }
};
