const pool = require('../database');

module.exports = async (message) => {

  if (!message.guild || message.author?.bot) return;

  // Get counting config
  const [config] = await pool.query(
    "SELECT * FROM counting WHERE guild_id = ?",
    [message.guildId]
  );

  if (!config) return;

  // Not the counting channel → ignore
  if (config.channel_id !== message.channel.id) return;

  // Was NOT the last counter → ignore
  if (config.last_user !== message.author.id) return;

  // ➜ Re-post the correct number
  try {
    await message.channel.send(
      `Next number: **${config.current}**`
    );
  } catch (err) {
    console.log("Could not resend deleted count:", err);

  }
};
