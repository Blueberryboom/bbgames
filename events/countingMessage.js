const pool = require('../database');

module.exports = async (message) => {

  if (message.author.bot) return;

  const [config] = await pool.query(
    "SELECT * FROM counting WHERE guild_id = ?",
    [message.guildId]
  );

  if (!config || config.channel_id !== message.channel.id) return;

  const number = parseInt(message.content);

  // ─── NOT A NUMBER ──────────────────────────
  if (isNaN(number)) {
    await message.delete().catch(() => {});
    return;
  }

  // ─── WRONG NUMBER ──────────────────────────
  if (number !== config.current + 1) {

    await message.delete().catch(() => {});

    // ➜ Add FAIL point
    await pool.query(`
      INSERT INTO counting_leaderboard
      (guild_id, user_id, fails)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE fails = fails + 1
    `, [message.guildId, message.author.id]);

    return;
  }

  // ─── DOUBLE COUNT ──────────────────────────
  if (config.last_user === message.author.id) {

    await message.delete().catch(() => {});

    await pool.query(`
      INSERT INTO counting_leaderboard
      (guild_id, user_id, fails)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE fails = fails + 1
    `, [message.guildId, message.author.id]);

    return;
  }

  // ─── SUCCESS ───────────────────────────────

  await pool.query(
    "UPDATE counting SET current = ?, last_user = ? WHERE guild_id = ?",
    [number, message.author.id, message.guildId]
  );

  // ➜ Add SCORE point
  await pool.query(`
    INSERT INTO counting_leaderboard
    (guild_id, user_id, score)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE score = score + 1
  `, [message.guildId, message.author.id]);
};
