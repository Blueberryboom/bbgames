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

  // ─────────────────────────────
  // 💬 SLASH COMMANDS
  // ─────────────────────────────
  if (interaction.isChatInputCommand()) {

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error('❌ Slash command error:', err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Command failed.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }


  // ─────────────────────────────
  // 🎉 BUTTONS (Giveaways)
  // ─────────────────────────────
  if (!interaction.isButton()) return;

  try {

    const parts = interaction.customId.split('_');
    if (parts.length < 3) return;

    const action = parts[1];
    const giveawayId = parts[2];

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

    // ─── JOIN BUTTON ───
    if (action === 'join') {

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

      return;
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
