const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');
const {
  upsertChannelConfig,
  removeChannelConfig
} = require('../utils/variableSlowmodeManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('variableslowmode')
    .setDescription('Automatically adjust channel slowmode based on chat speed')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Enable variable slowmode for a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to enable variable slowmode in')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('max_slowmode')
            .setDescription('Maximum slowmode in seconds (2-30)')
            .setRequired(true)
            .setMinValue(2)
            .setMaxValue(30)
        )
        .addIntegerOption(option =>
          option
            .setName('min_slowmode')
            .setDescription('Minimum slowmode in seconds (0-30)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(30)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Disable variable slowmode for a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to disable variable slowmode in')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List channels with variable slowmode enabled')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const channel = interaction.options.getChannel('channel', true);
      const maxSlowmode = interaction.options.getInteger('max_slowmode', true);
      const minSlowmode = interaction.options.getInteger('min_slowmode', true);

      if (maxSlowmode < 2 || maxSlowmode > 30) {
        return interaction.reply({
          content: '⚠️ Maximum slowmode must be between 2 and 30 seconds.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (minSlowmode > maxSlowmode) {
        return interaction.reply({
          content: '⚠️ Minimum slowmode cannot be greater than maximum slowmode.',
          flags: MessageFlags.Ephemeral
        });
      }

      const limit = await getPremiumLimit(interaction.client, interaction.guildId, 1, 5);
      const rows = await query(
        `SELECT channel_id
         FROM variable_slowmode_configs
         WHERE guild_id = ? AND enabled = 1`,
        [interaction.guildId]
      );

      const hasExistingForChannel = rows.some(row => row.channel_id === channel.id);
      if (!hasExistingForChannel && rows.length >= limit) {
        return interaction.reply({
          content: `⚠️ This server can only have ${limit} variable slowmode channel(s).`,
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        await channel.setRateLimitPerUser(minSlowmode, `Variable slowmode enabled by ${interaction.user.tag}`);
      } catch (err) {
        if (err?.code === 50013 || err?.code === 50001) {
          return interaction.reply({
            content: '⚠️ I cannot edit that channel slowmode. Please give me Manage Channels permission and ensure my role is high enough.',
            flags: MessageFlags.Ephemeral
          });
        }
        throw err;
      }

      await query(
        `INSERT INTO variable_slowmode_configs
         (guild_id, channel_id, min_slowmode, max_slowmode, enabled, updated_by, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
           min_slowmode = VALUES(min_slowmode),
           max_slowmode = VALUES(max_slowmode),
           enabled = 1,
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, minSlowmode, maxSlowmode, interaction.user.id, Date.now()]
      );

      upsertChannelConfig({
        guildId: interaction.guildId,
        channelId: channel.id,
        minSlowmode,
        maxSlowmode
      });

      return interaction.reply({
        content: `✅ Variable slowmode enabled for ${channel} (min: **${minSlowmode}s**, max: **${maxSlowmode}s**). Existing config for this channel was overwritten if it already existed.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'stop') {
      const channel = interaction.options.getChannel('channel', true);

      const result = await query(
        `DELETE FROM variable_slowmode_configs
         WHERE guild_id = ? AND channel_id = ?`,
        [interaction.guildId, channel.id]
      );

      removeChannelConfig(channel.id);

      if (!result.affectedRows) {
        return interaction.reply({
          content: `ℹ️ Variable slowmode was not enabled in ${channel}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.reply({
        content: `✅ Variable slowmode disabled in ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rows = await query(
      `SELECT channel_id, min_slowmode, max_slowmode
       FROM variable_slowmode_configs
       WHERE guild_id = ? AND enabled = 1
       ORDER BY updated_at DESC`,
      [interaction.guildId]
    );

    if (!rows.length) {
      return interaction.reply({
        content: 'No channels currently have variable slowmode enabled.',
        flags: MessageFlags.Ephemeral
      });
    }

    const limit = await getPremiumLimit(interaction.client, interaction.guildId, 1, 5);
    const lines = rows.map((row, index) => (
      `${index + 1}. <#${row.channel_id}> • min **${row.min_slowmode}s** • max **${row.max_slowmode}s**`
    )).join('\n');

    return interaction.reply({
      content: `📊 Variable slowmode channels (${rows.length}/${limit})\n${lines}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
