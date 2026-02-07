const pool = require('../database');

// channelId → timestamp
const cooldown = new Map();

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

  // ─── 30 SECOND COOLDOWN ──────────────────────
  const lastTime = cooldown.get(message.channel.id) || 0;
  const now = Date.now();

  if (now - lastTime < 30_000) {
    return; // still cooling down
  }

  cooldown.set(message.channel.id, now);
  // ─────────────────────────────────────────────

  // ➜ Re-post the correct number
  try {
    await message.channel.send(
      `⚠️ Current count: **${config.current}**`
    );
  } catch (err) {
    console.log("Could not resend deleted count:", err);
  }
};
