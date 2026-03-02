const pool = require('./index');

module.exports = async () => {

  // ─── GIVEAWAYS ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id VARCHAR(36) PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      channel_id VARCHAR(32) NOT NULL,
      message_id VARCHAR(32) NOT NULL,
      prize TEXT NOT NULL,
      winners INT NOT NULL,
      end_time BIGINT NOT NULL,
      required_role VARCHAR(32) NULL,
      title TEXT NULL,
      ended BOOLEAN DEFAULT 0,
      INDEX (guild_id),
      INDEX (ended),
      INDEX (end_time)
    );
  `);

  // ─── ENTRIES ───────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id VARCHAR(36),
      user_id VARCHAR(32),
      PRIMARY KEY (giveaway_id, user_id),
      INDEX (giveaway_id)
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

  // ─── BLACKLIST ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blacklist (
      guild_id VARCHAR(32) PRIMARY KEY,
      added_at BIGINT
    );
  `);

  // ─── COUNTING LEADERBOARD ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counting_leaderboard (
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      score INT DEFAULT 0,
      fails INT DEFAULT 0,
      PRIMARY KEY (guild_id, user_id),
      INDEX (guild_id)
    );
  `);

  console.log("✅ Database ready!");
};
