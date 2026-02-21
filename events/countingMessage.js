const pool = require('../database');

module.exports = async (message) => {

  if (!message.guild || message.author.bot) return;

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

  // Update DB first
  await pool.query(
    "UPDATE counting SET current = ?, last_user = ? WHERE guild_id = ?",
    [number, message.author.id, message.guildId]
  );

  await pool.query(`
    INSERT INTO counting_leaderboard
    (guild_id, user_id, score)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE score = score + 1
  `, [message.guildId, message.author.id]);

  // ─── WEBHOOK SYSTEM ────────────────────────

  let webhook;

  try {
    const hooks = await message.channel.fetchWebhooks();

    webhook = hooks.find(w => w.name === "Counting");

    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: "Counting"
      });
    }

    // Send as webhook
    await webhook.send({
      content: number.toString(),
      username: message.member.displayName,
      avatarURL: message.author.displayAvatarURL({ dynamic: true })
    });

    // Delete original message
    await message.delete().catch(() => {});

  } catch (err) {
    console.log("Webhook error:", err);
  }

};
