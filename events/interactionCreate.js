const { query } = require('../database/index');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  MessageFlags
} = require('discord.js');

module.exports = async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const parts = interaction.customId.split('_');
    if (parts.length < 3) return;

    const action = parts[1];
    const giveawayId = parts[2];

    // Fetch giveaway (FIXED — no destructuring)
    const rows = await query(
      `SELECT * FROM giveaways WHERE id = ?`,
      [giveawayId]
    );

    if (!rows || rows.length === 0) {
      return interaction.reply({
        content: 'Giveaway not found.',
        flags: MessageFlags.Ephemeral
      });
    }

    const giveaway = rows[0];

    if (giveaway.ended) {
      return interaction.reply({
        content: '❌ This giveaway has already ended.',
        flags: MessageFlags.Ephemeral
      });
    }

    // ─────────────────────────────
    // 🎉 JOIN BUTTON
    // ─────────────────────────────
    if (action === 'join') {

      if (giveaway.required_role) {
        const member = await interaction.guild.members
          .fetch(interaction.user.id)
          .catch(() => null);

        if (!member || !member.roles.cache.has(giveaway.required_role)) {
          return interaction.reply({
            content: `❌ You need the <@&${giveaway.required_role}> role to join.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const existing = await query(
        `SELECT * FROM giveaway_entries 
         WHERE giveaway_id = ? AND user_id = ?`,
        [giveawayId, interaction.user.id]
      );

      if (existing.length > 0) {
        await query(
          `DELETE FROM giveaway_entries 
           WHERE giveaway_id = ? AND user_id = ?`,
          [giveawayId, interaction.user.id]
        );

        await interaction.reply({
          content: '✅ You have left the giveaway.',
          flags: MessageFlags.Ephemeral
        });

      } else {

        await query(
          `INSERT INTO giveaway_entries (giveaway_id, user_id) 
           VALUES (?, ?)`,
          [giveawayId, interaction.user.id]
        );

        await interaction.reply({
          content: '✅ You have joined the giveaway!',
          flags: MessageFlags.Ephemeral
        });
      }

      // Update participant count
      try {
        const entries = await query(
          `SELECT COUNT(*) as count 
           FROM giveaway_entries 
           WHERE giveaway_id = ?`,
          [giveawayId]
        );

        const count = entries[0]?.count || 0;

        const channelMsg = await interaction.channel.messages
          .fetch(giveaway.message_id)
          .catch(() => null);

        if (channelMsg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`giveaway_join_${giveawayId}`)
              .setLabel('Join')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId(`giveaway_participants_${giveawayId}`)
              .setLabel(`Participants (${count})`)
              .setStyle(ButtonStyle.Secondary)
          );

          await channelMsg.edit({ components: [row] }).catch(() => {});
        }
      } catch (err) {
        console.error('❌ Failed to update participants button:', err);
      }
    }

    // ─────────────────────────────
    // 👥 PARTICIPANTS BUTTON
    // ─────────────────────────────
    if (action === 'participants') {

      const entries = await query(
        `SELECT user_id FROM giveaway_entries 
         WHERE giveaway_id = ?`,
        [giveawayId]
      );

      if (!entries || entries.length === 0) {
        return interaction.reply({
          content: 'No one has joined this giveaway yet.',
          flags: MessageFlags.Ephemeral
        });
      }

      const participants = entries.map(e => `<@${e.user_id}>`);
      const pageSize = 10;
      const pages = [];

      for (let i = 0; i < participants.length; i += pageSize) {
        pages.push(participants.slice(i, i + pageSize).join('\n'));
      }

      let currentPage = 0;

      const embed = new EmbedBuilder()
        .setTitle(giveaway.title || '🎉 Giveaway Participants')
        .setDescription(pages[currentPage])
        .setFooter({ text: `Page ${currentPage + 1} of ${pages.length}` })
        .setColor('#7289DA');

      const row = new ActionRowBuilder();

      if (pages.length > 1) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`participants_prev_${giveawayId}_${currentPage}`)
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),

          new ButtonBuilder()
            .setCustomId(`participants_next_${giveawayId}_${currentPage}`)
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Secondary)
        );
      }

      const replyMsg = await interaction.reply({
        embeds: [embed],
        components: row.components.length ? [row] : [],
        flags: MessageFlags.Ephemeral,
        fetchReply: true
      });

      if (pages.length <= 1) return;

      const collector = replyMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000
      });

      collector.on('collect', async btnInt => {

        if (btnInt.user.id !== interaction.user.id) {
          return btnInt.reply({
            content: '❌ You cannot control this pagination.',
            flags: MessageFlags.Ephemeral
          });
        }

        const [, dir, , page] = btnInt.customId.split('_');
        let pageIndex = parseInt(page);

        if (dir === 'next') pageIndex++;
        if (dir === 'prev') pageIndex--;

        if (pageIndex < 0) pageIndex = 0;
        if (pageIndex >= pages.length) pageIndex = pages.length - 1;

        const newEmbed = EmbedBuilder.from(embed)
          .setDescription(pages[pageIndex])
          .setFooter({ text: `Page ${pageIndex + 1} of ${pages.length}` });

        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`participants_prev_${giveawayId}_${pageIndex}`)
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex === 0),

          new ButtonBuilder()
            .setCustomId(`participants_next_${giveawayId}_${pageIndex}`)
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageIndex === pages.length - 1)
        );

        await btnInt.update({
          embeds: [newEmbed],
          components: [newRow]
        });
      });

      collector.on('end', async () => {
        try {
          await replyMsg.edit({ components: [] }).catch(() => {});
        } catch {}
      });
    }

  } catch (err) {
    console.error('❌ Giveaway button interaction error:', err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
};
