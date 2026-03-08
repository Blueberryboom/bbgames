const { query } = require('../database');

module.exports = {
  async clearGuildData(guildId) {
    if (!guildId) return;

    await query(
      `DELETE ge FROM giveaway_entries ge
       INNER JOIN giveaways g ON ge.giveaway_id = g.id
       WHERE g.guild_id = ?`,
      [guildId]
    );

    await query('DELETE FROM giveaways WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM youtube_subscriptions WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM admin_roles WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM counting WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM counting_leaderboard WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM support_requests WHERE guild_id = ?', [guildId]);
    await query('DELETE FROM blacklist WHERE guild_id = ?', [guildId]);
  }
};
