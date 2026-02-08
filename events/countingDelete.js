const pool = require('../database');

module.exports = async (message) => {
  if (!message.guild || message.author?.bot) return;

  const [config] = await pool.query(
    "SELECT * FROM counting WHERE guild_id = ?",
    [message.guildId]
  );

  if (!config) return;

  // Not counting channel
  if (config.channel_id !== message.channel.id) return;

  // Was NOT the last counter
  if (config.last_user !== message.author.id) return;

  // ─── EXISTING PROTECTION ─────────────────────
  try {
    const messages = await message.channel.messages.fetch({ limit: 1 });
    const last = messages.first();

    // If last message is from bot → already restored
    if (last?.author?.id === message.client.user.id) {
      return;
    }
  } catch (err) {
    console.log("Could not check last message:", err);
  }
  // ─────────────────────────────────────────────

  const content = `⚠️ Current count: **${config.current}**`;

  try {
    // ─── IF STATUS MESSAGE EXISTS → EDIT ────────
    if (config.status_message_id) {
      try {
        const statusMsg =
          await message.channel.messages.fetch(config.status_message_id);

        await statusMsg.edit(content);
        return;
      } catch {
        // Message was deleted manually → recreate
      }
    }

    // ─── OTHERWISE SEND NEW ─────────────────────
    const newMsg = await message.channel.send(content);

    await pool.query(
      `UPDATE counting
       SET status_message_id = ?
       WHERE guild_id = ?`,
      [newMsg.id, message.guildId]
    );

  } catch (err) {
    console.log("Could not resend deleted count:", err);
  }
};
