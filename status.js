const { ActivityType } = require('discord.js');

const statusIntervals = new WeakMap();

function stopStatus(client) {
  const interval = statusIntervals.get(client);
  if (interval) {
    clearInterval(interval);
    statusIntervals.delete(client);
  }
}

module.exports = (client) => {
  stopStatus(client);

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

    // Main bot: include premium-instance totals in presence.
    if (!client.isPremiumInstance && client.premiumManager?.getPremiumAggregateCounts) {
      if (client.shard) {
        const premiumStats = await client.shard.broadcastEval(c =>
          c.premiumManager?.getPremiumAggregateCounts
            ? c.premiumManager.getPremiumAggregateCounts()
            : { serverCount: 0, memberCount: 0 }
        );

        guildCount += premiumStats.reduce((acc, row) => acc + (Number(row.serverCount) || 0), 0);
        memberCount += premiumStats.reduce((acc, row) => acc + (Number(row.memberCount) || 0), 0);
      } else {
        const premiumStats = client.premiumManager.getPremiumAggregateCounts();
        guildCount += Number(premiumStats.serverCount) || 0;
        memberCount += Number(premiumStats.memberCount) || 0;
      }
    }

    // Premium bot: mirror the main bot's full network totals in presence.
    if (client.isPremiumInstance && client.premiumManager?.getNetworkAggregateCounts) {
      const networkStats = await client.premiumManager.getNetworkAggregateCounts();
      guildCount = Number(networkStats.serverCount) || guildCount;
      memberCount = Number(networkStats.memberCount) || memberCount;
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
  const interval = setInterval(updateStatus, 5 * 60 * 1000);
  statusIntervals.set(client, interval);

  client.once('shardDisconnect', () => stopStatus(client));
  client.once('invalidated', () => stopStatus(client));
};

module.exports.stopStatus = stopStatus;
