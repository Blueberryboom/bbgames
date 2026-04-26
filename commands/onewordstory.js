const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const {
  getStoryConfig,
  resetStory,
  MIN_WORD_DELAY_SECONDS,
  MAX_WORD_DELAY_SECONDS,
  DEFAULT_WORD_DELAY_SECONDS
} = require('../utils/oneWordStoryManager');

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
    )
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('Show contribution leaderboard')
    )

    .addSubcommand(sub =>
      sub
        .setName('delay')
        .setDescription('Set one-word-story processing delay in seconds (admin only)')
        .addIntegerOption(option =>
          option
            .setName('seconds')
            .setDescription('Delay in seconds')
            .setRequired(true)
            .setMinValue(MIN_WORD_DELAY_SECONDS)
            .setMaxValue(MAX_WORD_DELAY_SECONDS)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'channel') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
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
        content: `<:checkmark:1495875811792781332> One word story channel set to ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'disable') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
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
        content: '<:checkmark:1495875811792781332> One word story has been disabled and cleaned up.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'restart') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      await resetStory(interaction.guildId);

      return interaction.reply({
        content: '<:checkmark:1495875811792781332> One word story progress cleared and restarted.',
        flags: MessageFlags.Ephemeral
      });
    }

    
    if (sub === 'delay') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const seconds = interaction.options.getInteger('seconds', true);

      await query(
        `INSERT INTO one_word_story_settings
         (guild_id, channel_id, story_text, word_count, last_user_id, process_delay_seconds, updated_at)
         VALUES (?, NULL, '', 0, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
           process_delay_seconds = VALUES(process_delay_seconds),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, seconds, Date.now()]
      );

      return interaction.reply({
        content: `<:checkmark:1495875811792781332> One-word-story processing delay set to **${seconds}** second(s).`,
        flags: MessageFlags.Ephemeral
      });
    }

if (sub === 'leaderboard') {
      const rows = await query(
        `SELECT user_id,
                COUNT(*) AS contributions,
                ROUND(AVG(stars), 2) AS avg_rating
         FROM one_word_story_contributions
         WHERE guild_id = ?
         GROUP BY user_id
         ORDER BY contributions DESC, avg_rating DESC, user_id ASC`,
        [interaction.guildId]
      );

      if (!rows.length) {
        return interaction.reply({
          content: '📭 No one-word-story contributions yet.',
          flags: MessageFlags.Ephemeral
        });
      }

      const perPage = 10;
      const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
      let page = 0;
      const customBase = `ows_board:${interaction.id}`;

      const buildEmbed = () => {
        const slice = rows.slice(page * perPage, (page + 1) * perPage);
        const desc = slice.map((row, index) => {
          const rank = page * perPage + index + 1;
          return `#${rank} <@${row.user_id}>\n└ Contributions: **${Number(row.contributions || 0)}** • Avg Rating: **${Number(row.avg_rating || 0).toFixed(2)}⭐**`;
        }).join('\n\n');

        return new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🏆 One Word Story Leaderboard')
          .setDescription(desc)
          .setFooter({ text: `Page ${page + 1}/${totalPages} • ${rows.length} users` });
      };

      const components = () => [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${customBase}:left`).setLabel('⬅').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
          new ButtonBuilder().setCustomId(`${customBase}:me`).setLabel('Find Me').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${customBase}:right`).setLabel('➡').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1)
        )
      ];

      await interaction.reply({
        embeds: [buildEmbed()],
        components: components()
      });

      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000
      });

      collector.on('collect', async i => {
        if (!i.customId.startsWith(customBase)) return;
        if (i.customId.endsWith(':left')) {
          page = (page - 1 + totalPages) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: components() });
        }
        if (i.customId.endsWith(':right')) {
          page = (page + 1) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: components() });
        }
        const idx = rows.findIndex(row => row.user_id === i.user.id);
        if (idx === -1) {
          return i.reply({ content: 'You are not ranked on this leaderboard yet.', flags: MessageFlags.Ephemeral });
        }
        page = Math.floor(idx / perPage);
        return i.update({ embeds: [buildEmbed()], components: components() });
      });

      collector.on('end', async () => {
        await message.edit({ components: [] }).catch(() => null);
      });

      return;
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
        { name: 'Words', value: `${wordCount}/100`, inline: true },
        { name: 'Delay', value: `${Math.min(MAX_WORD_DELAY_SECONDS, Math.max(MIN_WORD_DELAY_SECONDS, Number(config.process_delay_seconds || DEFAULT_WORD_DELAY_SECONDS)))}s`, inline: true }
      )
      .setDescription(storyText || '*No words yet.*');

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
