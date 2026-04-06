async function getShardGuildAndMemberCounts(client) {
  if (client.shard) {
    const guildCounts = await client.shard.fetchClientValues('guilds.cache.size');
    const memberCounts = await client.shard.broadcastEval(c =>
      c.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0)
    );

    return {
      guildCount: guildCounts.reduce((a, b) => a + b, 0),
      memberCount: memberCounts.reduce((a, b) => a + b, 0)
    };
  }

  return {
    guildCount: client.guilds.cache.size,
    memberCount: client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0)
  };
}

async function getBotNetworkCounts(client) {
  let { guildCount, memberCount } = await getShardGuildAndMemberCounts(client);

  // Main bot: include premium-instance totals.
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

  // Premium bot: mirror the main bot's full network totals.
  if (client.isPremiumInstance && client.premiumManager?.getNetworkAggregateCounts) {
    const networkStats = await client.premiumManager.getNetworkAggregateCounts();
    guildCount = Number(networkStats.serverCount) || guildCount;
    memberCount = Number(networkStats.memberCount) || memberCount;
  }

  return { guildCount, memberCount };
}

module.exports = {
  getBotNetworkCounts
};
