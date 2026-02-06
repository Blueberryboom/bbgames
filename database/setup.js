const pool = require('./index');

module.exports = async () => {
  const conn = await pool.getConnection();

  // ─── GIVEAWAYS ─────────────────────────────
  await conn.query(`
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
  await conn.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id VARCHAR(36),
      user_id VARCHAR(32),
      PRIMARY KEY (giveaway_id, user_id)
    );
  `);

  // ─── EVENT ADMINS ──────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS event_admin_roles (
      guild_id VARCHAR(32),
      role_id VARCHAR(32),
      PRIMARY KEY (guild_id, role_id)
    );
  `);

  conn.release();
  console.log("✅ Database ready!");
};
