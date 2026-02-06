const { query } = require('./index');

module.exports = async () => {

  // Giveaways table
  await query(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(32),
      channel_id VARCHAR(32),
      guild_id VARCHAR(32),

      prize VARCHAR(255),
      winners INT,
      end_at BIGINT,

      required_role VARCHAR(32) NULL,

      ended BOOLEAN DEFAULT 0
    );
  `);

  // Entries table
  await query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      giveaway_id INT,
      user_id VARCHAR(32),

      UNIQUE KEY unique_entry (giveaway_id, user_id)
    );
  `);

  console.log("✅ Database tables ready");
};
