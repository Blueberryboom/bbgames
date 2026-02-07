const pool = require('./index');

module.exports = async () => {

  // ─── GIVEAWAYS ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id VARCHAR(36) PRIMARY KEY,
      guild_id VARCHAR(32),
      channel_id VARCHAR(32),
      message_id VARCHAR(32),
      prize TEXT,
      winners INT,
      end_time BIGINT,
      required_role VARCHAR(32) NULL,
      ended BOOLEAN DEFAULT 0
    );
  `);

  // ─── ENTRIES ───────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id VARCHAR(36),
      user_id VARCHAR(32),
      PRIMARY KEY (giveaway_id, user_id)
    );
  `);

  // ─── EVENT ADMINS ──────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_admin_roles (
      guild_id VARCHAR(32),
      role_id VARCHAR(32),
      PRIMARY KEY (guild_id, role_id)
    );
  `);

  // ─── COUNTING SYSTEM ───────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counting (
      guild_id VARCHAR(32) PRIMARY KEY,
      channel_id VARCHAR(32),
      current INT DEFAULT 0,
      last_user VARCHAR(32)
    );
  `);

  // 🏆 LEADERBOARD ────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counting_leaderboard (
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      score INT DEFAULT 0,
      fails INT DEFAULT 0,

      PRIMARY KEY (guild_id, user_id)
    );
  `);

  console.log("✅ Database ready!");
};
