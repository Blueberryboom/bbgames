const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_channel')
    .setDescription('Set the counting channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel for counting')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction))
      return interaction.reply({ content: "❌ No permission", ephemeral: true });

    const channel = interaction.options.getChannel('channel');

    await pool.query(`
      INSERT INTO counting (guild_id, channel_id, current)
      VALUES (?, ?, 0)
      ON DUPLICATE KEY UPDATE channel_id = ?
    `, [interaction.guildId, channel.id, channel.id]);

    await interaction.reply(`✅ Counting channel set to ${channel}`);
  
  }
};
