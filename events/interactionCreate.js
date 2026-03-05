const { query } = require('../database/index');
const {
  ActionRowBuilder,
  ButtonBuilder,
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
          content: `❌ ${err.message || 'Command failed.'}`,
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
    if (parts.length < 3 || parts[0] !== 'giveaway') return;

    const action = parts[1];
    const giveawayId = parts.slice(2).join('_');

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

    if (action === 'participants') {
      const countRows = await query(
        `SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?`,
        [giveawayId]
      );

      const total = Number(countRows[0]?.total || 0);

      return interaction.reply({
        content: `👥 **${total}** participant${total === 1 ? '' : 's'} entered this giveaway.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (giveaway.ended) {
      return interaction.reply({
        content: '❌ This giveaway has already ended.',
        flags: MessageFlags.Ephemeral
      });
    }

    // ─── JOIN BUTTON ───
    if (action === 'join') {

      if (giveaway.required_role) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(giveaway.required_role)) {
          return interaction.reply({
            content: `❌ You need <@&${giveaway.required_role}> to enter this giveaway.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const existing = await query(
        `SELECT 1 FROM giveaway_entries
         WHERE giveaway_id = ? AND user_id = ?`,
        [giveawayId, interaction.user.id]
      );

      let feedback;

      if (existing.length > 0) {
        await query(
          `DELETE FROM giveaway_entries
           WHERE giveaway_id = ? AND user_id = ?`,
          [giveawayId, interaction.user.id]
        );

        feedback = '✅ You have left the giveaway and all of your entries were removed.';
      } else {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const entryCount = getEntryCount(member, giveaway.extra_entries);

        await query(
          `INSERT INTO giveaway_entries (giveaway_id, user_id, entry_count)
           VALUES (?, ?, ?)`,
          [giveawayId, interaction.user.id, entryCount]
        );

        feedback = entryCount === 2
          ? '✅ You have joined the giveaway with **2 entries**!'
          : '✅ You have joined the giveaway!';
      }

      await refreshParticipantButton(interaction, giveawayId);

      await interaction.reply({
        content: feedback,
        flags: MessageFlags.Ephemeral
      });

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

function getEntryCount(member, extraEntriesRaw) {
  if (!member || !extraEntriesRaw) return 1;

  let parsed = extraEntriesRaw;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return 1;
    }
  }

  const roleId = parsed?.bonusRoleId;
  const multiplier = Number(parsed?.multiplier || 1);

  if (roleId && multiplier > 1 && member.roles.cache.has(roleId)) {
    return multiplier;
  }

  return 1;
}

async function refreshParticipantButton(interaction, giveawayId) {
  const countRows = await query(
    `SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?`,
    [giveawayId]
  );

  const total = Number(countRows[0]?.total || 0);

  const rows = interaction.message.components.map(row =>
    new ActionRowBuilder().addComponents(
      row.components.map(component => {
        if (component.customId === `giveaway_participants_${giveawayId}`) {
          return ButtonBuilder.from(component).setLabel(`Participants (${total})`);
        }
        return ButtonBuilder.from(component);
      })
    )
  );

  await interaction.message.edit({ components: rows }).catch(() => {});
}
