const { query } = require('../database');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BIRTHDAY_MESSAGE = 'Wishing {mention} a happy birthday! Be sure to congratulate them if you see them in chat!';

let intervalHandle = null;
let running = false;

async function runBirthdayCheck(client) {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const todayDay = now.getUTCDate();
    const todayMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const rows = await query(
      `SELECT bu.guild_id, bu.user_id, bs.channel_id
       FROM birthday_users bu
       INNER JOIN birthday_settings bs ON bs.guild_id = bu.guild_id
       WHERE bs.enabled = 1
         AND bu.day = ?
         AND bu.month = ?
         AND (bu.last_announced_year IS NULL OR bu.last_announced_year < ?)`,
      [todayDay, todayMonth, currentYear]
    );

    for (const row of rows) {
      const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id).catch(() => null);
      if (!guild) continue;

      const member = guild.members.cache.get(row.user_id) || await guild.members.fetch(row.user_id).catch(() => null);
      if (!member) {
        await cleanupMissingMemberBirthday(row.guild_id, row.user_id);
        continue;
      }

      const channel = guild.channels.cache.get(row.channel_id) || await guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;

      await channel.send({
        content: BIRTHDAY_MESSAGE.replace('{mention}', `<@${row.user_id}>`)
      }).catch(() => null);

      await query(
        `UPDATE birthday_users
         SET last_announced_year = ?, updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
        [currentYear, Date.now(), row.guild_id, row.user_id]
      );
    }
  } catch (error) {
    console.error('⚠️ Birthday scheduler error:', error);
  } finally {
    running = false;
  }
}

function initBirthdayScheduler(client) {
  if (intervalHandle) return;

  runBirthdayCheck(client);
  intervalHandle = setInterval(() => {
    runBirthdayCheck(client);
  }, CHECK_INTERVAL_MS);
}

async function cleanupMissingMemberBirthday(guildId, userId) {
  await query(
    'DELETE FROM birthday_users WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
}

async function cleanupUserGuildData(guildId, userId) {
  await Promise.all([
    query('DELETE FROM leveling_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]),
    query('DELETE FROM birthday_users WHERE guild_id = ? AND user_id = ?', [guildId, userId])
  ]);
}

module.exports = {
  initBirthdayScheduler,
  cleanupUserGuildData
};
