const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getStoryConfig, resetStory } = require('../utils/oneWordStoryManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('onewordstory')
    .setDescription('Configure and manage one word story')
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set the channel used for one word story (admin only)')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Target story channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable one word story module (admin only)')
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View the one word story so far')
    )
    .addSubcommand(sub =>
      sub
        .setName('restart')
        .setDescription('Restart the story and clear progress (admin only)')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'channel') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = interaction.options.getChannel('channel', true);

      await query(
        `INSERT INTO one_word_story_settings
         (guild_id, channel_id, story_text, word_count, last_user_id, updated_at)
         VALUES (?, ?, '', 0, NULL, ?)
         ON DUPLICATE KEY UPDATE
           channel_id = VALUES(channel_id),
           story_text = '',
           word_count = 0,
           last_user_id = NULL,
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, Date.now()]
      );

      return interaction.reply({
        content: `✅ One word story channel set to ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'disable') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `UPDATE one_word_story_settings
         SET channel_id = NULL, story_text = '', word_count = 0, last_user_id = NULL, updated_at = ?
         WHERE guild_id = ?`,
        [Date.now(), interaction.guildId]
      );

      return interaction.reply({
        content: '✅ One word story has been disabled and cleaned up.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'restart') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      await resetStory(interaction.guildId);

      return interaction.reply({
        content: '✅ One word story progress cleared and restarted.',
        flags: MessageFlags.Ephemeral
      });
    }

    const config = await getStoryConfig(interaction.guildId);

    if (!config || !config.channel_id) {
      return interaction.reply({
        content: 'ℹ️ One word story is currently disabled in this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const wordCount = Number(config.word_count || 0);
    const storyText = (config.story_text || '').trim();

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('One Word Story • Current Progress')
      .addFields(
        { name: 'Channel', value: `<#${config.channel_id}>`, inline: true },
        { name: 'Words', value: `${wordCount}/100`, inline: true }
      )
      .setDescription(storyText || '*No words yet.*');

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
