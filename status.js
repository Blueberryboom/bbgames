const { ActivityType } = require('discord.js');

module.exports = (client) => {

  const updateStatus = () => {
    const guildCount = client.guilds.cache.size;

    client.user.setPresence({
      activities: [{
        name: `🎉 ${guildCount} servers`,
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
