const { query } = require('../database');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Collection
} = require('discord.js');

const activeGiveaways = new Collection();

module.exports = {

  // ─────────────────────────────
  // INIT SYSTEM
  // ─────────────────────────────
  initGiveawaySystem: async (client) => {
    try {
      const rows = await query(`SELECT * FROM giveaways WHERE ended = 0`);

      for (const giveaway of rows) {
        scheduleEnd(client, giveaway);
        activeGiveaways.set(giveaway.id, giveaway);
      }

      const now = Date.now();
      await query(
        `DELETE FROM giveaways 
         WHERE ended = 1 AND end_time < ?`,
        [now - 7 * 24 * 60 * 60 * 1000]
      );

      console.log(`✅ Giveaway system initialized. ${rows.length} active giveaways loaded.`);
    } catch (err) {
      console.error('❌ Failed to init giveaway system:', err);
    }
  },

  // ─────────────────────────────
  // CREATE
  // ─────────────────────────────
  createGiveaway: async (client, data) => {
    try {
      const {
        id,
        guildId,
        channelId,
        messageId,
        prize,
        winners,
        endTime,
        requiredRole,
        title
      } = data;

      await query(
        `INSERT INTO giveaways 
        (id, guild_id, channel_id, message_id, prize, winners, end_time, required_role, title, ended)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          id,
          guildId,
          channelId,
          messageId,
          prize,
          winners,
          endTime,
          requiredRole || null,
          title || null
        ]
      );

      const giveawayObj = {
        id,
        guild_id: guildId,
        channel_id: channelId,
        message_id: messageId,
        prize,
        winners,
        end_time: endTime,
        required_role: requiredRole,
        title,
        ended: 0
      };

      activeGiveaways.set(id, giveawayObj);
      scheduleEnd(client, giveawayObj);

      return id;
    } catch (err) {
      console.error('❌ Failed to create giveaway:', err);
      throw err;
    }
  },

  // ─────────────────────────────
  // END EARLY
  // ─────────────────────────────
  endGiveaway: async (client, giveawayId) => {
    try {
      const rows = await query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');

      const giveaway = rows[0];
      if (giveaway.ended) throw new Error('Giveaway already ended');

      await concludeGiveaway(client, giveaway);
    } catch (err) {
      console.error('❌ Failed to end giveaway:', err);
      throw err;
    }
  },

  // ─────────────────────────────
  // REROLL
  // ─────────────────────────────
  rerollGiveaway: async (client, giveawayId) => {
    try {
      const rows = await query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');

      const giveaway = rows[0];
      if (!giveaway.ended) throw new Error('Giveaway has not ended yet');

      const entries = await query(
        `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
        [giveawayId]
      );

      if (!entries.length) throw new Error('No participants to reroll');

      const winners = pickWinners(
        entries.map(e => e.user_id),
        giveaway.winners
      );

      const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
      if (!channel) return;

      await channel.send(
        `🎉 Giveaway rerolled! New winner(s): ${winners.map(id => `<@${id}>`).join(', ')} for **${giveaway.prize}**!`
      ).catch(() => {});
    } catch (err) {
      console.error('❌ Failed to reroll giveaway:', err);
      throw err;
    }
  },

  // ─────────────────────────────
  // DELETE
  // ─────────────────────────────
  deleteGiveaway: async (client, giveawayId) => {
    try {
      const rows = await query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');

      const giveaway = rows[0];

      await disableButtons(client, giveaway);

      await query(`DELETE FROM giveaway_entries WHERE giveaway_id = ?`, [giveawayId]);
      await query(`DELETE FROM giveaways WHERE id = ?`, [giveawayId]);

      activeGiveaways.delete(giveawayId);

      return true;
    } catch (err) {
      console.error('❌ Failed to delete giveaway:', err);
      throw err;
    }
  },

  // ─────────────────────────────
  // LIST
  // ─────────────────────────────
  listActiveGiveaways: async (guildId) => {
    try {
      return await query(
        `SELECT * FROM giveaways 
         WHERE guild_id = ? AND ended = 0
         ORDER BY end_time ASC`,
        [guildId]
      );
    } catch (err) {
      console.error('❌ Failed to list giveaways:', err);
      return [];
    }
  }
};

//
// ─────────────────────────────────────────────
// INTERNALS
// ─────────────────────────────────────────────
//

function scheduleEnd(client, giveaway) {
  const delay = giveaway.end_time - Date.now();

  if (delay <= 0) {
    concludeGiveaway(client, giveaway).catch(() => {});
    return;
  }

  setTimeout(() => {
    concludeGiveaway(client, giveaway).catch(() => {});
  }, delay);
}

async function concludeGiveaway(client, giveaway) {
  try {
    await query(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveaway.id]);
    activeGiveaways.delete(giveaway.id);

    const entries = await query(
      `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
      [giveaway.id]
    );

    const winners = pickWinners(
      entries.map(e => e.user_id),
      giveaway.winners
    );

    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;

    await disableButtons(client, giveaway);

    if (!winners.length) {
      await channel.send(`😢 Giveaway ended for **${giveaway.prize}** but no one participated!`).catch(() => {});
    } else {
      await channel.send(
        `🎉 Congratulations to ${winners.map(id => `<@${id}>`).join(', ')} for winning **${giveaway.prize}**!`
      ).catch(() => {});
    }

  } catch (err) {
    console.error('❌ Failed to conclude giveaway:', err);
  }
}

async function disableButtons(client, giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (!msg) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('disabled')
        .setLabel('Join')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('disabled')
        .setLabel('Participants')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    await msg.edit({ components: [row] }).catch(() => {});
  } catch {}
}

function pickWinners(users, amount) {
  if (!users.length) return [];

  const shuffled = [...users].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(amount, users.length));
}
