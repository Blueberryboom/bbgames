const { ActivityType } = require('discord.js');

module.exports = (client) => {

  const updateStatus = () => {

    const guildCount = client.guilds.cache.size;

    // Count all members across all servers
    const memberCount = client.guilds.cache.reduce(
      (total, guild) => total + (guild.memberCount || 0),
      0
    );

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
