const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');

const { query } = require('../database');

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

    // ⭐ YOUR REQUEST ⭐
    .addRoleOption(o =>
      o.setName('required_role')
        .setDescription('Role required to enter (optional)')
        .setRequired(false)
    )

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

  async execute(interaction) {

    const prize = interaction.options.getString('prize');
    const winners = interaction.options.getInteger('winners');
    const minutes = interaction.options.getInteger('minutes');

    const requiredRole =
      interaction.options.getRole('required_role');

    const endAt = Date.now() + minutes * 60 * 1000;

    // Embed
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

    // Save to DB
    await query(`
      INSERT INTO giveaways
      (message_id, channel_id, guild_id, prize, winners, end_at, required_role)
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
