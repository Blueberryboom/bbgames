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

    .addIntegerOption(o =>
      o.setName('minutes')
        .setDescription('How long should it last?')
        .setRequired(true)
    )

    .addRoleOption(o =>
      o.setName('required_role')
        .setDescription('Role required to enter (optional)')
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
    const minutes = interaction.options.getInteger('minutes');
    const requiredRole = interaction.options.getRole('required_role');

    const endAt = Date.now() + minutes * 60 * 1000;

    // ─── EMBED ───────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway!")
      .setColor(0x5865F2)
      .setDescription(
`**Prize:** ${prize}
**Winners:** ${winners}

${requiredRole
  ? `🔒 Required Role: <@&${requiredRole.id}>`
  : `🌍 Anyone can enter!`}`
      )
      .setFooter({ text: "Ends" })
      .setTimestamp(endAt);

    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('Enter Giveaway')
          .setStyle(ButtonStyle.Success)
      );

    // ─── SEND MESSAGE (modern method) ────────
    const response = await interaction.reply({
      embeds: [embed],
      components: [button],
      withResponse: true   // new discord.js style
    });

    const msg = response.resource.message;

    // ─── CREATE ID ONCE ──────────────────────
    const giveawayId = uuidv4();

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

    // ─── TELL CREATOR THE ID ─────────────────
    await interaction.followUp({
      content:
        `✅ Giveaway created!\n🆔 ID: \`${giveawayId}\`\n` +
        `Use this for:\n• /giveaway-end\n• /giveaway-reroll`,
      ephemeral: true
    });
  }
};
