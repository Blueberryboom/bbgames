const { query } = require('../database');

module.exports = (client) => {

  setInterval(async () => {

    const giveaways = await query(`
      SELECT * FROM giveaways
      WHERE ended = 0 AND end_at < ?
    `, [Date.now()]);

    for (const g of giveaways) {

      const entries = await query(`
        SELECT user_id FROM giveaway_entries
        WHERE giveaway_id = ?
      `, [g.id]);

      if (!entries.length) continue;

      const winners = entries
        .sort(() => Math.random() - 0.5)
        .slice(0, g.winners);

      const channel =
        await client.channels.fetch(g.channel_id);

      channel.send(
        `🎉 Giveaway ended!\nPrize: **${g.prize}**\n` +
        `Winners: ${
          winners.map(w => `<@${w.user_id}>`).join(', ')
        }`
      );

      await query(`
        UPDATE giveaways
        SET ended = 1
        WHERE id = ?
      `, [g.id]);
    }

  }, 60 * 1000);
};
