const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting_channel')
    .setDescription('Set the counting channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel for counting (recommended)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('channel_text')
        .setDescription('Channel mention, ID, or name')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
    }

    const channelOption = interaction.options.getChannel('channel');
    const channelText = interaction.options.getString('channel_text');

    const channel = channelOption || resolveGuildTextChannel(interaction.guild, channelText);

    if (!channel) {
      return interaction.reply({
        content: '❌ Please provide a valid text channel using the selector, mention, ID, or exact channel name.',
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

function resolveGuildTextChannel(guild, input) {
  if (!input) return null;

  const trimmed = input.trim();
  const mention = trimmed.match(/^<#(\d+)>$/);
  const id = mention ? mention[1] : (/^\d+$/.test(trimmed) ? trimmed : null);

  if (id) {
    const byId = guild.channels.cache.get(id);
    return byId?.type === ChannelType.GuildText ? byId : null;
  }

  const normalized = trimmed.toLowerCase().replace(/^#/, '');

  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && channel.name.toLowerCase() === normalized
  ) || null;
}
