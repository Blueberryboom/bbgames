const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const pool = require('../database/index');
const ms = require('ms');

// Interval in milliseconds for checking giveaways
const CHECK_INTERVAL = 15000; // 15 seconds

/**
 * Initialize the giveaway system
 * @param {Client} client 
 */
async function initGiveawaySystem(client) {
  setInterval(async () => {
    try {
      await checkAndEndGiveaways(client);
      await cleanupOldGiveaways();
    } catch (err) {
      console.error('❌ Giveaway system error:', err);
    }
  }, CHECK_INTERVAL);

  console.log('✅ Giveaway system initialized');
}

/**
 * Check the DB for giveaways that need to end and end them
 * @param {Client} client 
 */
async function checkAndEndGiveaways(client) {
  const now = Date.now();

  // Fetch active giveaways that should end
  const [giveaways] = await pool.query(
    `SELECT * FROM giveaways WHERE ended = 0 AND end_time <= ?`,
    [now]
  );

  for (const giveaway of giveaways) {
    try {
      // End each giveaway safely
      await endGiveaway(client, giveaway);
    } catch (err) {
      console.error(`❌ Error ending giveaway ${giveaway.id}:`, err);
    }
  }
}

/**
 * End a giveaway
 * @param {Client} client 
 * @param {Object} giveaway 
 */
async function endGiveaway(client, giveaway) {
  if (giveaway.ended) return;

  // Lock giveaway in DB to avoid double ending
  const [result] = await pool.query(
    `UPDATE giveaways SET ended = 1 WHERE id = ? AND ended = 0`,
    [giveaway.id]
  );
  if (result.affectedRows === 0) return; // Already ended by another shard

  // Fetch participants
  const [entries] = await pool.query(
    `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
    [giveaway.id]
  );
  if (!entries.length) {
    await announceNoWinners(client, giveaway);
    return;
  }

  // Handle extra entries
  let weighted = [];
  const extraEntries = giveaway.extra_entries ? JSON.parse(giveaway.extra_entries) : {};
  for (const entry of entries) {
    let count = 1;
    for (const [roleId, weight] of Object.entries(extraEntries)) {
      try {
        const member = await client.guilds.cache.get(giveaway.guild_id)?.members.fetch(entry.user_id).catch(() => null);
        if (member && member.roles.cache.has(roleId)) count += Number(weight);
      } catch {}
    }
    for (let i = 0; i < count; i++) weighted.push(entry.user_id);
  }

  // Randomly pick winners
  const winners = [];
  const numberOfWinners = Math.min(giveaway.winners, entries.length);
  while (winners.length < numberOfWinners && weighted.length) {
    const index = Math.floor(Math.random() * weighted.length);
    const winner = weighted.splice(index, 1)[0];
    if (!winners.includes(winner)) winners.push(winner);
  }

  // Edit original giveaway embed
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
      if (msg) {
        const embed = EmbedBuilder.from(msg.embeds[0])
          .setFooter({ text: `Giveaway ended | Hosted by ${embedFooter(giveaway.host_id, client)}` });

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`disabled`).setLabel('Join').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId(`disabled`).setLabel('Participants').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );

        await msg.edit({ embeds: [embed], components: [disabledRow] });
      }
    }
  } catch (err) {
    console.error(`❌ Failed to edit giveaway message ${giveaway.id}:`, err);
  }

  // Announce winners
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (channel) {
      const mentions = winners.map(u => `<@${u}>`).join(', ');
      await channel.send(`🎉 Congratulations to ${mentions} for winning the giveaway: **${giveaway.prize}**!`);
    }
  } catch (err) {
    console.error(`❌ Failed to announce winners for ${giveaway.id}:`, err);
  }
}

/**
 * Helper: announce no winners
 */
async function announceNoWinners(client, giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (channel) {
      await channel.send(`❌ Giveaway for **${giveaway.prize}** ended with no participants.`);
    }
  } catch {}
}

/**
 * Helper: reroll a giveaway
 */
async function rerollGiveaway(client, giveaway) {
  // Reset ended to 0 temporarily to use endGiveaway logic
  giveaway.ended = 0;
  await endGiveaway(client, giveaway);
}

/**
 * Cleanup giveaways older than 7 days
 */
async function cleanupOldGiveaways() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    const [oldGiveaways] = await pool.query(
      `SELECT id FROM giveaways WHERE ended = 1 AND end_time <= ?`,
      [cutoff]
    );
    for (const g of oldGiveaways) {
      await pool.query(`DELETE FROM giveaways WHERE id = ?`, [g.id]);
      await pool.query(`DELETE FROM giveaway_entries WHERE giveaway_id = ?`, [g.id]);
    }
  } catch (err) {
    console.error('❌ Giveaway cleanup failed:', err);
  }
}

/**
 * Helper to safely get host tag
 */
function embedFooter(userId, client) {
  try {
    const member = client.users.cache.get(userId);
    return member ? member.tag : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

module.exports = {
  initGiveawaySystem,
  endGiveaway,
  rerollGiveaway
};
