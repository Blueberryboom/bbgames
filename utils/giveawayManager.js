const { query } = require('../database');
const {
  ActionRowBuilder,
  ButtonBuilder,
  Collection,
  EmbedBuilder
} = require('discord.js');

const activeGiveaways = new Collection();
const activeTimeouts = new Collection();

module.exports = {

  // ─────────────────────────────
  // INIT SYSTEM
  // ─────────────────────────────
  initGiveawaySystem: async (client) => {
    try {
      const rows = await query(
        `SELECT * FROM giveaways WHERE ended = 0`
      );

      for (const giveaway of rows) {
        activeGiveaways.set(giveaway.id, giveaway);
        scheduleEnd(client, giveaway);
      }

      console.log(`✅ Giveaway system initialized. ${rows.length} active giveaways loaded.`);
    } catch (err) {
      console.error('❌ Failed to init giveaway system:', err);
    }
  },

  // ─────────────────────────────
  // CREATE
  // ─────────────────────────────
  createGiveaway: async (client, data) => {

    await query(
      `INSERT INTO giveaways 
      (id, guild_id, channel_id, message_id, host_id, prize, winners, end_time, required_role, title, ended)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        data.id,
        data.guildId,
        data.channelId,
        data.messageId,
        data.hostId,
        data.prize,
        data.winners,
        data.endTime,
        data.requiredRole || null,
        data.title || null
      ]
    );

    const giveawayObj = {
      id: data.id,
      guild_id: data.guildId,
      channel_id: data.channelId,
      message_id: data.messageId,
      host_id: data.hostId,
      prize: data.prize,
      winners: data.winners,
      end_time: data.endTime,
      required_role: data.requiredRole,
      title: data.title,
      ended: 0
    };

    activeGiveaways.set(data.id, giveawayObj);
    scheduleEnd(client, giveawayObj);
  },

  // ─────────────────────────────
  // END EARLY
  // ─────────────────────────────
  endGiveaway: async (client, giveawayId) => {

    const giveaway = await getGiveaway(giveawayId);
    if (!giveaway) throw new Error('Giveaway not found');
    if (giveaway.ended) throw new Error('Giveaway already ended');

    await concludeGiveaway(client, giveaway);
  },

  // ─────────────────────────────
  // REROLL
  // ─────────────────────────────
  rerollGiveaway: async (client, giveawayId) => {

    const giveaway = await getGiveaway(giveawayId);
    if (!giveaway) throw new Error('Giveaway not found');
    if (!giveaway.ended) throw new Error('Giveaway has not ended yet');

    const entries = await query(
      `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
      [giveawayId]
    );

    if (!entries.length) throw new Error('No participants to reroll');

    const winners = pickWinners(
      entries.map(e => e.user_id),
      Number(giveaway.winners)
    );

    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;

    await channel.send(
      `🎉 Giveaway rerolled! New winner(s): ${winners.map(id => `<@${id}>`).join(', ')} for **${giveaway.prize}**!`
    );
  },

  // ─────────────────────────────
  // DELETE
  // ─────────────────────────────
  deleteGiveaway: async (client, giveawayId) => {

    const giveaway = await getGiveaway(giveawayId);
    if (!giveaway) throw new Error('Giveaway not found');

    clearTimeout(activeTimeouts.get(giveawayId));
    activeTimeouts.delete(giveawayId);
    activeGiveaways.delete(giveawayId);

    await disableButtons(client, giveaway);

    await query(`DELETE FROM giveaway_entries WHERE giveaway_id = ?`, [giveawayId]);
    await query(`DELETE FROM giveaways WHERE id = ?`, [giveawayId]);
  },

  // ─────────────────────────────
  // LIST
  // ─────────────────────────────
  listActiveGiveaways: async (guildId) => {

    return await query(
      `SELECT * FROM giveaways 
       WHERE guild_id = ? AND ended = 0
       ORDER BY end_time ASC`,
      [guildId]
    );
  }
};

//
// ─────────────────────────────
// INTERNALS
// ─────────────────────────────
//

async function getGiveaway(id) {
  const rows = await query(`SELECT * FROM giveaways WHERE id = ?`, [id]);
  return rows.length ? rows[0] : null;
}

function scheduleEnd(client, giveaway) {

  const delay = Number(giveaway.end_time) - Date.now();

  if (delay <= 0) {
    concludeGiveaway(client, giveaway);
    return;
  }

  const timeout = setTimeout(() => {
    concludeGiveaway(client, giveaway);
  }, delay);

  activeTimeouts.set(giveaway.id, timeout);
}

async function concludeGiveaway(client, giveaway) {

  const fresh = await getGiveaway(giveaway.id);
  if (!fresh || fresh.ended) return;

  await query(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveaway.id]);

  clearTimeout(activeTimeouts.get(giveaway.id));
  activeTimeouts.delete(giveaway.id);
  activeGiveaways.delete(giveaway.id);

  const entries = await query(
    `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
    [giveaway.id]
  );

  const winners = pickWinners(
    entries.map(e => e.user_id),
    Number(giveaway.winners)
  );

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);

  if (msg) {
    const embed = EmbedBuilder.from(msg.embeds[0])
      .setFooter({ text: '🎉 Giveaway Ended' });

    await msg.edit({
      embeds: [embed],
      components: disableRow(msg.components)
    }).catch(() => {});
  }

  if (!winners.length) {
    await channel.send(`😢 Giveaway ended for **${giveaway.prize}** but no one participated!`);
  } else {
    await channel.send(
      `🎉 Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`
    );
  }
}

function disableRow(rows) {
  if (!rows.length) return [];

  return rows.map(row =>
    new ActionRowBuilder().addComponents(
      row.components.map(btn =>
        ButtonBuilder.from(btn).setDisabled(true)
      )
    )
  );
}

async function disableButtons(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (!msg) return;

  await msg.edit({
    components: disableRow(msg.components)
  }).catch(() => {});
}

function pickWinners(users, amount) {
  if (!users.length) return [];
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(amount, users.length));
}
