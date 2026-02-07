const pool = require('../database');

module.exports = async (message) => {
  if (message.author.bot) return;

  const [config] = await pool.query(
    "SELECT * FROM counting WHERE guild_id = ?",
    [message.guildId]
  );

  if (!config || config.channel_id !== message.channel.id) return;

  const number = parseInt(message.content);
  if (isNaN(number)) {
    await message.delete().catch(()=>{});
    return;
  }

  // Must be next number
  if (number !== config.current + 1) {
    await message.delete().catch(()=>{});
    await message.channel.send(
      `❌ Wrong number ${message.author}! Next is **${config.current + 1}**`
    );
    return;
  }

  // No double counting
  if (config.last_user === message.author.id) {
    await message.delete().catch(()=>{});
    await message.channel.send(
      `❌ You can't count twice in a row ${message.author}!`
    );
    return;
  }

  // SUCCESS
  await pool.query(
    "UPDATE counting SET current = ?, last_user = ? WHERE guild_id = ?",
    [number, message.author.id, message.guildId]
  );

  await message.react("✅").catch(()=>
    {});
};
