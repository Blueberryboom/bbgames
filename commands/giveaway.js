const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../database');

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

    // ⭐ Optional role required to ENTER ⭐
    .addRoleOption(o =>
      o.setName('required_role')
        .setDescription('Role required to enter (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {

    // ─── PERMISSION CHECK ───────────────────

    const isAdmin =
      interaction.member.permissions.has("Administrator");

    // Check DB for allowed roles
    const allowedRoles = await pool.query(
      "SELECT role_id FROM event_admin_roles WHERE guild_id = ?",
      [interaction.guildId]
    );

    const hasRole = allowedRoles.some(r =>
      interaction.member.roles.cache.has(r.role_id)
    );

    if (!isAdmin && !hasRole) {
      return interaction.reply({
        content:
          "❌ You must be an event admin to create giveaways!",
        ephemeral: true
      });
    }

    // ─── OPTIONS ─────────────────────────────

    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');
    const minutes = interaction.options.getInteger('minutes');

    const requiredRole =
      interaction.options.getRole('required_role');

    const endAt = Date.now() + minutes * 60 * 1000;

    // ─── EMBED ───────────────────────────────

    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway!")
      .setColor(0x5865F2)
      .setDescription(`
**Prize:** ${prize}  
**Winners:** ${winners}

${requiredRole
  ? `🔒 Required Role: <@&${requiredRole.id}>`
  : `🌍 Anyone can enter!`}
      `)
      .setFooter({ text: "Ends" })
      .setTimestamp(endAt);

    const button = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('Enter Giveaway')
          .setStyle(ButtonStyle.Success)
      );

    const msg = await interaction.reply({
      embeds: [embed],
      components: [button],
      fetchReply: true
    });

    // ─── SAVE TO DB ──────────────────────────

    await pool.query(`
      INSERT INTO giveaways
      (message_id, channel_id, guild_id, prize, winners, end_time, required_role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      msg.id,
      msg.channelId,
      interaction.guildId,
      prize,
      winners,
      endAt,
      requiredRole?.id || null
    ]);
  }
};
