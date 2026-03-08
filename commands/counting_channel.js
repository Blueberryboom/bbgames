const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_channel')
    .setDescription('Set the counting channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel for counting')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('channel');

    if (!channel || channel.guildId !== interaction.guildId || channel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: '❌ Please select a valid text channel from this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    await pool.query(
      `INSERT INTO counting (guild_id, channel_id, current)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE channel_id = ?`,
      [interaction.guildId, channel.id, channel.id]
    );

    await interaction.reply(`✅ Counting channel set to ${channel}`);
  }
};
