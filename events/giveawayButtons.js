const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../database');

module.exports = async (interaction) => {

  if (!interaction.isButton()) return;
  if (interaction.customId !== 'giveaway_enter') return;

  // ─── LOAD GIVEAWAY ────────────────────────
  const rows = await pool.query(
    `SELECT * FROM giveaways WHERE message_id = ?`,
    [interaction.message.id]
  );

  const giveaway = rows[0];

  if (!giveaway) {
    return interaction.reply({
      content: "❌ Giveaway not found",
      ephemeral: true
    });
  }

  // ─── ROLE REQUIREMENT CHECK ───────────────
  if (giveaway.required_role) {
    const member = interaction.member;

    if (!member.roles.cache.has(giveaway.required_role)) {
      return interaction.reply({
        content: "❌ You don't have the required role to enter!",
        ephemeral: true
      });
    }
  }

  // ─── INSERT ENTRY ─────────────────────────
  let justJoined = false;

  try {
    await pool.query(`
      INSERT INTO giveaway_entries
      (giveaway_id, user_id)
      VALUES (?, ?)
    `, [
      giveaway.id,
      interaction.user.id
    ]);

    justJoined = true;

    await interaction.reply({
      content: "✅ You entered the giveaway!",
      ephemeral: true
    });

  } catch (err) {

    await interaction.reply({
      content: "⚠️ You already entered!",
      ephemeral: true
    });

  }

  // ─── UPDATE BUTTON COUNT ──────────────────
  try {

    // Count total entries FROM DB (restart safe)
    const [countRow] = await pool.query(
      "SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?",
      [giveaway.id]
    );

    const total = Number(countRow.total || 0);

    // Rebuild button with new number
    await interaction.message.edit({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('giveaway_enter')
            .setLabel(`Enter Giveaway (${total})`)
            .setStyle(ButtonStyle.Success)
        )
      ]
    });

  } catch (err) {
    console.log("Could not update giveaway counter:", err);
  }
};
