const pool = require('../database/index');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection } = require('discord.js');
const ms = require('ms'); // For parsing duration strings

// In-memory cache for giveaways per guild (shard-safe)
const activeGiveaways = new Collection();

module.exports = {
  initGiveawaySystem: async (client) => {
    try {
      // Load all active giveaways from DB
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE ended = 0`);
      for (const giveaway of rows) {
        scheduleEnd(client, giveaway);
        activeGiveaways.set(giveaway.id, giveaway);
      }

      // Cleanup giveaways older than 7 days
      const now = Date.now();
      await pool.query(`DELETE FROM giveaways WHERE ended = 1 AND end_time < ?`, [now - 7 * 24 * 60 * 60 * 1000]);

      console.log(`✅ Giveaway system initialized. ${rows.length} active giveaways loaded.`);
    } catch (err) {
      console.error('❌ Failed to init giveaway system:', err);
    }
  },

  // ─── CREATE GIVEAWAY ─────────────────────────
  createGiveaway: async (client, giveawayData) => {
    try {
      const { guildId, channelId, prize, winners, endTime, requiredRole, title, hostId, messageId } = giveawayData;

      const id = giveawayData.id; // Already generated UUID

      // Insert into DB
      await pool.query(
        `INSERT INTO giveaways (id, guild_id, channel_id, message_id, prize, winners, end_time, required_role, title) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, guildId, channelId, messageId, prize, winners, endTime, requiredRole || null, title || null]
      );

      // Schedule the giveaway end
      scheduleEnd(client, { id, guild_id: guildId, channel_id: channelId, prize, winners, end_time: endTime, required_role: requiredRole, title, message_id: messageId });

      activeGiveaways.set(id, { id, guild_id: guildId, channel_id: channelId, prize, winners, end_time: endTime, required_role: requiredRole, title, message_id: messageId, ended: 0 });

      return id;
    } catch (err) {
      console.error('❌ Failed to create giveaway:', err);
      throw err;
    }
  },

  // ─── END GIVEAWAY EARLY ─────────────────────
  endGiveaway: async (client, giveawayId) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');
      const giveaway = rows[0];

      if (giveaway.ended) throw new Error('Giveaway already ended');

      await concludeGiveaway(client, giveaway);
    } catch (err) {
      console.error('❌ Failed to end giveaway:', err);
      throw err;
    }
  },

  // ─── REROLL GIVEAWAY ────────────────────────
  rerollGiveaway: async (client, giveawayId) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');
      const giveaway = rows[0];

      if (!giveaway.ended) throw new Error('Giveaway has not ended yet');

      const [entries] = await pool.query(`SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`, [giveawayId]);
      if (!entries.length) throw new Error('No participants to reroll');

      const winners = pickWinners(entries.map(e => e.user_id), giveaway.winners);

      const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
      if (channel) {
        channel.send(`🎉 Giveaway rerolled! New winner(s): ${winners.map(id => `<@${id}>`).join(', ')} for **${giveaway.prize}**!`).catch(() => {});
      }

    } catch (err) {
      console.error('❌ Failed to reroll giveaway:', err);
      throw err;
    }
  },

  // ─── DELETE GIVEAWAY ───────────────────────
  deleteGiveaway: async (client, giveawayId) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) throw new Error('Giveaway not found');
      const giveaway = rows[0];

      // Remove message buttons
      const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
        if (msg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('disabled').setLabel('Join').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('disabled').setLabel('Participants').setStyle(ButtonStyle.Secondary).setDisabled(true)
          );
          await msg.edit({ components: [row] }).catch(() => {});
        }
      }

      // Remove from DB
      await pool.query(`DELETE FROM giveaway_entries WHERE giveaway_id = ?`, [giveawayId]);
      await pool.query(`DELETE FROM giveaways WHERE id = ?`, [giveawayId]);
      activeGiveaways.delete(giveawayId);

      return true;
    } catch (err) {
      console.error('❌ Failed to delete giveaway:', err);
      throw err;
    }
  },

  // ─── LIST ACTIVE GIVEAWAYS ─────────────────
  listActiveGiveaways: async (guildId) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY end_time ASC`, [guildId]);
      return rows;
    } catch (err) {
      console.error('❌ Failed to list giveaways:', err);
      return [];
    }
  }
};

// ─────────────────────────────────────────────
// ─── INTERNAL HELPERS ────────────────────────
// ─────────────────────────────────────────────

async function scheduleEnd(client, giveaway) {
  const delay = giveaway.end_time - Date.now();
  if (delay <= 0) return concludeGiveaway(client, giveaway); // Already expired

  setTimeout(() => {
    concludeGiveaway(client, giveaway).catch(err => console.error('❌ Failed to auto-end giveaway:', err));
  }, delay);
}

async function concludeGiveaway(client, giveaway) {
  try {
    // Mark giveaway ended
    await pool.query(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveaway.id]);
    activeGiveaways.delete(giveaway.id);

    const [entries] = await pool.query(`SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`, [giveaway.id]);
    const winnerIds = pickWinners(entries.map(e => e.user_id), giveaway.winners);

    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;

    // Edit original message to disable buttons
    const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (msg) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('disabled').setLabel('Join').setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('disabled').setLabel('Participants').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      await msg.edit({ components: [row] }).catch(() => {});
    }

    // Announce winners
    if (!winnerIds.length) {
      channel.send(`😢 Giveaway ended for **${giveaway.prize}** but no one participated!`).catch(() => {});
    } else {
      channel.send(`🎉 Congratulations to ${winnerIds.map(id => `<@${id}>`).join(', ')} for winning **${giveaway.prize}**!`).catch(() => {});
    }
  } catch (err) {
    console.error('❌ Failed to conclude giveaway:', err);
  }
}

function pickWinners(users, amount) {
  if (!users.length) return [];
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(amount, users.length));
}
