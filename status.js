const { ActivityType } = require('discord.js');

module.exports = (client) => {

  const updateStatus = async () => {

    let guildCount = 0;
    let memberCount = 0;

    // ─── IF SHARDING ENABLED ─────────────────────────
    if (client.shard) {

      // Get guild counts from all shards
      const guildCounts = await client.shard.fetchClientValues(
        'guilds.cache.size'
      );

      guildCount = guildCounts.reduce((a, b) => a + b, 0);

      // Get member totals from all shards
      const memberCounts = await client.shard.broadcastEval(c =>
        c.guilds.cache.reduce(
          (acc, g) => acc + (g.memberCount || 0),
          0
        )
      );

      memberCount = memberCounts.reduce((a, b) => a + b, 0);

    } 
    // ─── SINGLE INSTANCE FALLBACK ─────────────────────
    else {

      guildCount = client.guilds.cache.size;

      memberCount = client.guilds.cache.reduce(
        (total, guild) => total + (guild.memberCount || 0),
        0
      );
    }

    // ─── SET PRESENCE ─────────────────────────────────
    client.user.setPresence({
      activities: [{
        name: `👀 ${memberCount} members | ${guildCount} servers`,
        type: ActivityType.Watching
      }],
      status: 'online'
    });
  };

  // Update when bot starts
  updateStatus();

  // Update every 5 minutes
  setInterval(updateStatus, 5 * 60 * 1000);
};
