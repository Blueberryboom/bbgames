const pool = require('../database');

module.exports = async (message) => {
  if (message.author.bot) return;

  const [rows] = await pool.query(
    "SELECT * FROM counting WHERE guild_id = ?",
    [message.guildId]
  );

  const config = rows?.[0];
  if (!config || config.channel_id !== message.channel.id) return;

  const number = parseInt(message.content);

  // ❌ Not a number → delete silently
  if (isNaN(number)) {
    return message.delete().catch(() => {});
  }

  // ❌ Wrong number → delete silently
  if (number !== config.current + 1) {
    return message.delete().catch(() => {});
  }

  // ❌ Same user twice → delete silently
  if (config.last_user === message.author.id) {
    return message.delete().catch(() => {});
  }

  // ✅ SUCCESS – update count
  await pool.query(
    "UPDATE counting SET current = ?, last_user = ? WHERE guild_id = ?",
    [number, message.author.id, message.guildId]
  );

  // 🏆 Leaderboard tracking (if table exists)
  await pool.query(`
    INSERT INTO counting_leaderboard (guild_id, user_id, score)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE score = score + 1
  `, [message.guildId, message.author.id]);
};
