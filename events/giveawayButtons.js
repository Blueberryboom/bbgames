const { query } = require('../database');

module.exports = async (interaction) => {

  if (!interaction.isButton()) return;

  if (interaction.customId !== 'giveaway_enter')
    return;

  const [giveaway] = await query(
    `SELECT * FROM giveaways WHERE message_id = ?`,
    [interaction.message.id]
  );

  if (!giveaway)
    return interaction.reply({
      content: "Giveaway not found",
      ephemeral: true
    });

  // ⭐ ROLE REQUIREMENT CHECK ⭐
  if (giveaway.required_role) {

    const member = interaction.member;

    if (!member.roles.cache.has(giveaway.required_role)) {
      return interaction.reply({
        content:
          "❌ You don't have the required role to enter!",
        ephemeral: true
      });
    }
  }

  try {
    await query(`
      INSERT INTO giveaway_entries
      (giveaway_id, user_id)
      VALUES (?, ?)
    `, [giveaway.id, interaction.user.id]);

    await interaction.reply({
      content: "✅ You entered the giveaway!",
      ephemeral: true
    });

  } catch {
    await interaction.reply({
      content: "⚠️ You already entered!",
      ephemeral: true
    });
  }
};
