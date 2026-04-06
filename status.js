const { ActivityType } = require('discord.js');
const { getBotNetworkCounts } = require('./utils/botStats');

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
    const { guildCount, memberCount } = await getBotNetworkCounts(client);

    // ─── SET PRESENCE ─────────────────────────────────
    let activity = {
      name: `👀 ${memberCount} members | ${guildCount} servers`,
      type: ActivityType.Watching
    };

    if (client.isPremiumInstance && Array.isArray(client.customStatuses) && client.customStatuses.length) {
      const index = client.customStatusIndex || 0;
      activity = {
        name: client.customStatuses[index % client.customStatuses.length],
        type: ActivityType.Playing
      };
      client.customStatusIndex = (index + 1) % client.customStatuses.length;
    }

    client.user.setPresence({
      activities: [activity],
      status: 'online'
    });
  };

  // Update when bot starts
  updateStatus();

  // Update every 3 minutes
  const interval = setInterval(updateStatus, 3 * 60 * 1000);
  statusIntervals.set(client, interval);

  client.once('shardDisconnect', () => stopStatus(client));
  client.once('invalidated', () => stopStatus(client));
};

module.exports.stopStatus = stopStatus;
