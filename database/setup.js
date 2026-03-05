const pool = require('./index');

module.exports = async () => {
  try {
    // ─── GIVEAWAYS ─────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id VARCHAR(36) PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_id VARCHAR(32) NOT NULL,
        host_id VARCHAR(32) NOT NULL,
        prize TEXT NOT NULL,
        winners INT NOT NULL,
        end_time BIGINT NOT NULL,
        required_role VARCHAR(32) NULL,
        title TEXT NULL,
        extra_entries JSON NULL,
        ended BOOLEAN NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_guild (guild_id),
        INDEX idx_endtime (end_time),
        INDEX idx_ended (ended)
      ) ENGINE=InnoDB;
    `);

    // ─── GIVEAWAY ENTRIES ───────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        entry_count INT NOT NULL DEFAULT 1,
        PRIMARY KEY (giveaway_id, user_id),
        INDEX idx_giveaway (giveaway_id)
      ) ENGINE=InnoDB;
    `);



    // ─── GIVEAWAY MIGRATIONS ──────────────
    await pool.query(`
      ALTER TABLE giveaway_entries
      ADD COLUMN IF NOT EXISTS entry_count INT NOT NULL DEFAULT 1
    `);


    // ─── YOUTUBE SUBSCRIPTIONS ─────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS youtube_subscriptions (
        guild_id VARCHAR(32) NOT NULL,
        youtube_channel_id VARCHAR(64) NOT NULL,
        discord_channel_id VARCHAR(32) NOT NULL,
        ping_role_id VARCHAR(32) NULL,
        last_video_id VARCHAR(32) NULL,
        last_checked_at BIGINT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, youtube_channel_id),
        INDEX idx_yt_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    // ─── EVENT ADMIN ROLES ──────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_roles (
        guild_id VARCHAR(32) NOT NULL,
        role_id VARCHAR(32) NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      ) ENGINE=InnoDB;
    `);

    // ─── COUNTING SYSTEM ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS counting (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32),
        current INT DEFAULT 0,
        last_user VARCHAR(32)
      ) ENGINE=InnoDB;
    `);

    // ─── BLACKLIST ─────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        guild_id VARCHAR(32) PRIMARY KEY,
        added_at BIGINT NOT NULL
      ) ENGINE=InnoDB;
    `);

    // ─── COUNTING LEADERBOARD ──────────────
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

    console.log("✅ Database setup complete!");
  } catch (err) {
    console.error("❌ Error setting up database:", err);
  }
};
