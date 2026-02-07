const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { v4: uuidv4 } = require('uuid');

// ─── TIME PARSER ───────────────────────────
function parseDuration(input) {
  const regex = /(\d+)\s*(d|h|m)/gi;

  let totalMs = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 'd') totalMs += value * 24 * 60 * 60 * 1000;
    if (unit === 'h') totalMs += value * 60 * 60 * 1000;
    if (unit === 'm') totalMs += value * 60 * 1000;
  }

  return totalMs;
}
// ───────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway')

    .addStringOption(o =>
      o.setName('prize')
        .setDescription('What are you giving away?')
        .setRequired(true)
    )

    .addIntegerOption(o =>
      o.setName('winners')
        .setDescription('Number of winners')
        .setRequired(true)
    )

    // ⭐ CHANGED: duration string instead of minutes
    .addStringOption(o =>
      o.setName('duration')
        .setDescription('Example: 1d 2h 30m / 5h / 10m')
        .setRequired(true)
    )

    .addRoleOption(o =>
      o.setName('required_role')
        .setDescription('Role required to enter (optional)')
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('title')
        .setDescription('Custom embed title (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {

    // ─── PERMISSION CHECK ───────────────────
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: "❌ You must be an event admin to create giveaways!",
        ephemeral: true
      });
    }

    // ─── OPTIONS ─────────────────────────────
    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');
    const durationInput = interaction.options.getString('duration');
    const requiredRole = interaction.options.getRole('required_role');

    const customTitle =
      interaction.options.getString('title') || "🎉 Giveaway!";

    // ─── PARSE TIME ──────────────────────────
    const durationMs = parseDuration(durationInput);

    if (!durationMs || durationMs < 60000) {
      return interaction.reply({
        content:
          "❌ Invalid duration! Examples:\n" +
          "`10m` `2h` `1d` `1d 2h 30m`",
        ephemeral: true
      });
    }

    const endAt = Date.now() + durationMs;

    // ─── CREATE ID ───────────────────────────
    const giveawayId = uuidv4();

    // ─── EMBED ───────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle(customTitle)
      .setColor(0x5865F2)
      .setDescription(
`**Prize:** ${prize}
**Winners:** ${winners}

${requiredRole
  ? `🔒 Required Role: <@&${requiredRole.id}>`
  : `🌍 Anyone can enter!`}`
      )

      // ✅ ID ONLY IN FOOTER NOW
      .setFooter({
        text: `Ends • ID: ${giveawayId}`
      })
      .setTimestamp(endAt);

    // ⭐ Button starts at 0 entries
    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('Enter Giveaway (0)')
          .setStyle(ButtonStyle.Success)
      );

    // ─── SEND MESSAGE ────────────────────────
    const response = await interaction.reply({
      embeds: [embed],
      components: [button],
      withResponse: true
    });

    const msg = response.resource.message;

    // ─── SAVE TO DB ──────────────────────────
    await pool.query(`
      INSERT INTO giveaways
      (id, message_id, channel_id, guild_id, prize, winners, end_time, required_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      giveawayId,
      msg.id,
      msg.channelId,
      interaction.guildId,
      prize,
      winners,
      endAt,
      requiredRole?.id || null
    ]);

    // ─── CREATOR CONFIRM ─────────────────────
    await interaction.followUp({
      content:
`✅ Giveaway created!

🆔 ID: \`${giveawayId}\`

You can use this for:
• /giveaway-end  
• /giveaway-reroll`,
      ephemeral: true
    });
  }
};
