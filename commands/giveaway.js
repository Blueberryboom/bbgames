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

// ─── TIME PARSER ────────────────────────────
function parseDuration(input) {
  const regex = /(\d+)\s*(d|h|m)/gi;

  let total = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 'd') total += value * 24 * 60;
    if (unit === 'h') total += value * 60;
    if (unit === 'm') total += value;
  }

  return total; // minutes
}
// ────────────────────────────────────────────

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

    // ⭐ CHANGED TO STRING
    .addStringOption(o =>
      o.setName('duration')
        .setDescription('Time like: 1d 2h 30m')
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

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: "❌ You must be an event admin to create giveaways!",
        ephemeral: true
      });
    }

    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');
    const durationInput = interaction.options.getString('duration');
    const requiredRole = interaction.options.getRole('required_role');

    const customTitle =
      interaction.options.getString('title') || "🎉 Giveaway!";

    // ─── PARSE TIME ──────────────────────────
    const minutes = parseDuration(durationInput);

    if (!minutes || minutes <= 0) {
      return interaction.reply({
        content:
`❌ Invalid time format!

Examples:
• \`1d\`
• \`2h 30m\`
• \`1d 6h\`
• \`45m\``,
        ephemeral: true
      });
    }

    const endAt = Date.now() + minutes * 60 * 1000;
    const unix = Math.floor(endAt / 1000);

    const giveawayId = uuidv4();

    const embed = new EmbedBuilder()
      .setTitle(customTitle)
      .setColor(0x5865F2)

      .setDescription(
`**Prize:** ${prize}
**Winners:** ${winners}

${requiredRole
  ? `🔒 Required Role: <@&${requiredRole.id}>`
  : `🌍 Anyone can enter!`}

⏱ **Ends:** <t:${unix}:R>`
      )

      // ✅ ID ONLY IN FOOTER
      .setFooter({
        text: `ID: ${giveawayId}`
      })

      .setTimestamp(endAt);

    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('Enter Giveaway (0)')
          .setStyle(ButtonStyle.Success)
      );

    const response = await interaction.reply({
      embeds: [embed],
      components: [button],
      withResponse: true
    });

    const msg = response.resource.message;

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
