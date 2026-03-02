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
      ended BOOLEAN NOT NULL DEFAULT 0,

      INDEX idx_guild (guild_id),
      INDEX idx_endtime (end_time),
      INDEX idx_ended (ended)

    ) ENGINE=InnoDB;
  `);

  // ─── GIVEAWAY ENTRIES ──────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(32) NOT NULL,

      PRIMARY KEY (giveaway_id, user_id),
      INDEX idx_giveaway (giveaway_id)

    ) ENGINE=InnoDB;
  `);

  // ─── EVENT ADMIN ROLES ─────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      guild_id VARCHAR(32) NOT NULL,
      role_id VARCHAR(32) NOT NULL,

      PRIMARY KEY (guild_id, role_id)

    ) ENGINE=InnoDB;
  `);

  // ─── COUNTING SYSTEM ───────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counting (
      guild_id VARCHAR(32) PRIMARY KEY,
      channel_id VARCHAR(32),
      current INT DEFAULT 0,
      last_user VARCHAR(32)

    ) ENGINE=InnoDB;
  `);

  // ─── BLACKLIST ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blacklist (
      guild_id VARCHAR(32) PRIMARY KEY,
      added_at BIGINT NOT NULL

    ) ENGINE=InnoDB;
  `);

  // ─── COUNTING LEADERBOARD ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counting_leaderboard (
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      score INT DEFAULT 0,
      fails INT DEFAULT 0,

      PRIMARY KEY (guild_id, user_id),
      INDEX idx_lb_guild (guild_id)

    ) ENGINE=InnoDB;
  `);

  console.log("✅ Database ready!");
};
