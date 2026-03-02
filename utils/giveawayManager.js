const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const pool = require('../database');

const activeTimeouts = new Map();

/* ------------------ DURATION PARSER ------------------ */

function parseDuration(input) {
  const regex = /(\d+)\s*(d|h|m)/gi;
  let total = 0;
  let match;

  while ((match = regex.exec(input))) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 'd') total += value * 86400000;
    if (unit === 'h') total += value * 3600000;
    if (unit === 'm') total += value * 60000;
  }

  return total;
}

/* ------------------ CLEANUP SYSTEM ------------------ */

async function cleanupOldGiveaways() {
  const sevenDays = Date.now() - 7 * 86400000;

  await pool.query(
    `DELETE FROM giveaways WHERE ended=1 AND end_time < ?`,
    [sevenDays]
  );

  await pool.query(
    `DELETE FROM giveaway_entries 
     WHERE giveaway_id NOT IN (SELECT id FROM giveaways)`
  );
}

/* ------------------ END GIVEAWAY ------------------ */

async function endGiveaway(client, giveawayId, silent = false) {
  const rows = await pool.query(
    `SELECT * FROM giveaways WHERE id=?`,
    [giveawayId]
  );

  if (!rows.length) return;

  const g = rows[0];
  if (g.ended) return;

  const entries = await pool.query(
    `SELECT user_id FROM giveaway_entries WHERE giveaway_id=?`,
    [giveawayId]
  );

  const guild = await client.guilds.fetch(g.guild_id).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(g.channel_id).catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(g.message_id).catch(() => null);

  await pool.query(
    `UPDATE giveaways SET ended=1 WHERE id=?`,
    [giveawayId]
  );

  let winnerMentions = 'No winners.';
  if (entries.length) {
    const shuffled = entries.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, g.winners);
    winnerMentions = winners.map(w => `<@${w.user_id}>`).join(', ');
  }

  const embed = new EmbedBuilder()
    .setTitle(g.title || '🎉 Giveaway Ended')
    .setDescription(`**Prize:** ${g.prize}\n\n🏆 Winners:\n${winnerMentions}`)
    .setColor(0xED4245)
    .setTimestamp();

  if (message) {
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ended')
        .setLabel('Giveaway Ended')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    await message.edit({ components: [disabledRow] }).catch(() => {});
  }

  if (!silent) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  activeTimeouts.delete(giveawayId);
}

/* ------------------ SCHEDULER ------------------ */

async function scheduleGiveaway(client, giveaway) {
  const remaining = giveaway.end_time - Date.now();

  if (remaining <= 0) {
    return endGiveaway(client, giveaway.id);
  }

  const timeout = setTimeout(() => {
    endGiveaway(client, giveaway.id);
  }, remaining);

  activeTimeouts.set(giveaway.id, timeout);
}

/* ------------------ INIT SYSTEM ------------------ */

async function initGiveawaySystem(client) {
  await cleanupOldGiveaways();

  const active = await pool.query(
    `SELECT * FROM giveaways WHERE ended=0`
  );

  for (const g of active) {
    await scheduleGiveaway(client, g);
  }

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    try {
      /* ---------- JOIN BUTTON ---------- */
      if (interaction.customId.startsWith('gw_join_')) {
        const id = interaction.customId.replace('gw_join_', '');

        const rows = await pool.query(
          `SELECT * FROM giveaways WHERE id=?`,
          [id]
        );

        if (!rows.length || rows[0].ended)
          return interaction.reply({ content: 'Giveaway ended.', flags: 64 });

        const g = rows[0];

        if (g.required_role &&
            !interaction.member.roles.cache.has(g.required_role)) {
          return interaction.reply({
            content: 'You do not have the required role.',
            flags: 64
          });
        }

        const existing = await pool.query(
          `SELECT * FROM giveaway_entries WHERE giveaway_id=? AND user_id=?`,
          [id, interaction.user.id]
        );

        if (existing.length) {
          await pool.query(
            `DELETE FROM giveaway_entries WHERE giveaway_id=? AND user_id=?`,
            [id, interaction.user.id]
          );
        } else {
          await pool.query(
            `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`,
            [id, interaction.user.id]
          );
        }

        const countRows = await pool.query(
          `SELECT COUNT(*) as count FROM giveaway_entries WHERE giveaway_id=?`,
          [id]
        );

        const count = countRows[0].count;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`gw_join_${id}`)
            .setLabel(`Enter Giveaway (${count})`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`gw_list_${id}`)
            .setLabel('Participants')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({ components: [row] });
      }

      /* ---------- PARTICIPANTS BUTTON ---------- */
      if (interaction.customId.startsWith('gw_list_')) {
        const id = interaction.customId.replace('gw_list_', '');

        const entries = await pool.query(
          `SELECT user_id FROM giveaway_entries WHERE giveaway_id=?`,
          [id]
        );

        if (!entries.length)
          return interaction.reply({ content: 'No participants yet.', flags: 64 });

        const perPage = 10;
        let page = 0;
        const totalPages = Math.ceil(entries.length / perPage);

        const buildEmbed = () => {
          const slice = entries.slice(page * perPage, (page + 1) * perPage);
          return new EmbedBuilder()
            .setTitle('Participants')
            .setDescription(slice.map(e => `<@${e.user_id}>`).join('\n'))
            .setFooter({ text: `Page ${page + 1}/${totalPages}` });
        };

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
        );

        const msg = await interaction.reply({
          embeds: [buildEmbed()],
          components: [row],
          flags: 64
        });

        const collector = msg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000
        });

        collector.on('collect', async i => {
          if (i.user.id !== interaction.user.id)
            return i.reply({ content: 'Not your menu.', flags: 64 });

          if (i.customId === 'prev' && page > 0) page--;
          if (i.customId === 'next' && page < totalPages - 1) page++;

          await i.update({ embeds: [buildEmbed()] });
        });
      }

    } catch (err) {
      if (!interaction.replied)
        await interaction.reply({ content: `Error: ${err.message}`, flags: 64 });
    }
  });
}

module.exports = {
  parseDuration,
  initGiveawaySystem,
  endGiveaway
};
