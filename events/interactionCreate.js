const pool = require('../database/index');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const [action, giveawayId] = interaction.customId.split('_').slice(1); // 'giveaway_join_<ID>' or 'giveaway_participants_<ID>'

    // Fetch giveaway from DB
    const [rows] = await pool.query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
    if (!rows.length) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });

    const giveaway = rows[0];

    if (giveaway.ended) {
      return interaction.reply({ content: '❌ This giveaway has already ended.', ephemeral: true });
    }

    // ─── JOIN BUTTON ─────────────────────────
    if (action === 'join') {
      // Check required role
      if (giveaway.required_role) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(giveaway.required_role)) {
          return interaction.reply({ content: `❌ You need the <@&${giveaway.required_role}> role to join.`, ephemeral: true });
        }
      }

      // Check if user already joined
      const [existing] = await pool.query(
        `SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
        [giveawayId, interaction.user.id]
      );

      if (existing.length) {
        // Remove entry (unjoin)
        await pool.query(
          `DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
          [giveawayId, interaction.user.id]
        );
        await interaction.reply({ content: '✅ You have left the giveaway.', ephemeral: true });
      } else {
        // Add entry
        await pool.query(
          `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`,
          [giveawayId, interaction.user.id]
        );
        await interaction.reply({ content: '✅ You have joined the giveaway!', ephemeral: true });
      }

      // Update participants button label on the original message
      try {
        const [entries] = await pool.query(
          `SELECT COUNT(*) as count FROM giveaway_entries WHERE giveaway_id = ?`,
          [giveawayId]
        );
        const count = entries[0]?.count || 0;

        const channel = await interaction.channel.messages.fetch(giveaway.message_id).catch(() => null);
        if (channel) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`giveaway_join_${giveawayId}`)
              .setLabel('Join')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`giveaway_participants_${giveawayId}`)
              .setLabel(`Participants (${count})`) // <-- dynamic count
              .setStyle(ButtonStyle.Secondary)
          );

          await channel.edit({ components: [row] }).catch(() => {});
        }
      } catch (err) {
        console.error('❌ Failed to update participants button:', err);
      }

    }

    // ─── PARTICIPANTS BUTTON ─────────────────
    if (action === 'participants') {
      // Fetch all participants
      const [entries] = await pool.query(
        `SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`,
        [giveawayId]
      );

      if (!entries.length) {
        return interaction.reply({ content: 'No one has joined this giveaway yet.', ephemeral: true });
      }

      // Paginate participants (10 per page)
      const participants = entries.map(e => `<@${e.user_id}>`);
      const pageSize = 10;
      const pages = [];

      for (let i = 0; i < participants.length; i += pageSize) {
        pages.push(participants.slice(i, i + pageSize).join('\n'));
      }

      const embeds = pages.map((p, i) =>
        new EmbedBuilder()
          .setTitle(giveaway.title || '🎉 Giveaway Participants')
          .setDescription(p)
          .setFooter({ text: `Page ${i + 1} of ${pages.length}` })
          .setColor('#7289DA')
      );

      // Send first page (can later add buttons for page navigation)
      return interaction.reply({ embeds: [embeds[0]], ephemeral: true });
    }

  } catch (err) {
    console.error('❌ Giveaway button interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
};
