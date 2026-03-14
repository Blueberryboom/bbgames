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

    // ─── GLOBAL COUNTS (SHARD SAFE) ──────────
    let serverCount = 0;
    let memberCount = 0;

    if (client.shard) {

      const guildCounts = await client.shard.fetchClientValues(
        'guilds.cache.size'
      );
      serverCount = guildCounts.reduce((a, b) => a + b, 0);

      const memberCounts = await client.shard.broadcastEval(c =>
        c.guilds.cache.reduce(
          (acc, g) => acc + (g.memberCount || 0),
          0
        )
      );
      memberCount = memberCounts.reduce((a, b) => a + b, 0);

    } else {

      serverCount = client.guilds.cache.size;

      memberCount = client.guilds.cache.reduce(
        (acc, guild) => acc + (guild.memberCount || 0),
        0
      );
    }

    // ─── SHARD INFO X / Y ────────────────────
    let shardDisplay = 'Standalone';

    if (client.shard) {
      const current = client.shard.ids[0] + 1;   // make human friendly
      const total = client.shard.count;

      shardDisplay = `Shard **${current} / ${total}**`;
    }

    // ─── PREMIUM STATUS ──────────────────────
    let premiumDisplay = 'No';

    if (!interaction.inGuild()) {
      if (client.shard) {
        const userId = interaction.user.id;
        const results = await client.shard.broadcastEval(
          (c, context) => c.premiumManager?.hasInstanceForUser(context.userId) || false,
          { context: { userId } }
        );
        premiumDisplay = results.some(Boolean) ? 'Yes' : 'No';
      } else {
        premiumDisplay = client.premiumManager?.hasInstanceForUser(interaction.user.id) ? 'Yes' : 'No';
      }
    }

    // ─── BUILD EMBED ─────────────────────────
    const embed = new EmbedBuilder()
      .setTitle('🟢 Bot Status')
      .setColor(0x57F287)

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
          value: shardDisplay,
          inline: true
        },

        {
          name: '💎 Premium',
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
