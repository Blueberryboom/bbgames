const { SlashCommandBuilder, MessageFlags, ChannelType, EmbedBuilder } = require('discord.js');
const pool = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('Counting commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('current')
        .setDescription('Show current count')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('channel')
        .setDescription('Set the counting channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for counting')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('removechannel')
        .setDescription('Stop counting (keeps number)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset')
        .setDescription('Reset count for this guild')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('leaderboard')
        .setDescription('Show top counters')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set the current count')
        .addIntegerOption(option =>
          option
            .setName('number')
            .setDescription('The number to set as the current count')
            .setRequired(true)
            .setMinValue(0)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'current') {
      const [row] = await pool.query(
        'SELECT current FROM counting WHERE guild_id = ?',
        [interaction.guildId]
      );

      await interaction.reply(
        row
          ? `🔢 Current count: **${row.current}**`
          : '<:warning:1496193692099285255> Counting not set up'
      );
      return;
    }

    if (subcommand === 'channel') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '<:warning:1496193692099285255> No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = interaction.options.getChannel('channel');

      if (!channel || channel.guildId !== interaction.guildId || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: '<:warning:1496193692099285255> Please select a valid text channel from this server.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await pool.query(
        `INSERT INTO counting (guild_id, channel_id, current)
         VALUES (?, ?, 0)
         ON DUPLICATE KEY UPDATE channel_id = ?`,
        [interaction.guildId, channel.id, channel.id]
      );

      await interaction.reply(`<:checkmark:1495875811792781332> Counting channel set to ${channel}`);
      return;
    }

    if (subcommand === 'removechannel') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '<:warning:1496193692099285255> No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      await pool.query(
        'UPDATE counting SET channel_id = NULL WHERE guild_id = ?',
        [interaction.guildId]
      );

      await interaction.reply('🛑 Counting channel removed (count saved)');
      return;
    }

    if (subcommand === 'reset') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '<:warning:1496193692099285255> No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      await pool.query(
        'DELETE FROM counting WHERE guild_id = ?',
        [interaction.guildId]
      );

      await interaction.reply('💥 Counting data reset! Successfully reset counting channel and count.');
      return;
    }

    if (subcommand === 'leaderboard') {
      const rows = await pool.query(`
        SELECT *
        FROM counting_leaderboard
        WHERE guild_id = ?
        ORDER BY score DESC
        LIMIT 10
      `, [interaction.guildId]);

      if (!rows.length) {
        await interaction.reply('📭 No counting data yet!');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🏆 Counting Leaderboard')
        .setColor(0x5865F2);

      let desc = '';

      rows.forEach((row, index) => {
        const total = row.score + row.fails;
        const rate = total === 0 ? 100 : Math.round((row.score / total) * 100);

        desc += `**#${index + 1}** <@${row.user_id}>\n➤ Score: **${row.score}**\n➤ Fails: **${row.fails}**\n➤ Success: **${rate}%**\n\n`;
      });

      embed.setDescription(desc);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'set') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '<:warning:1496193692099285255> No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      const number = interaction.options.getInteger('number', true);
      if (number > 100000) {
        await interaction.reply({
          content: '<:warning:1496193692099285255> Counts above **100000** require approval. Please open a support ticket in my Discord if you are switching from an existing bot and have a count of 100000+.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const [existing] = await pool.query(
        'SELECT channel_id FROM counting WHERE guild_id = ?',
        [interaction.guildId]
      );
      const countingChannelId = existing?.channel_id;

      if (!countingChannelId) {
        await interaction.reply({
          content: '<:warning:1496193692099285255> You need to set a counting channel first with `/count channel` before setting the number.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const countingChannel = await interaction.guild.channels.fetch(countingChannelId).catch(() => null);
      if (!countingChannel || !countingChannel.isTextBased()) {
        await interaction.reply({
          content: '<:warning:1496193692099285255> The configured counting channel could not be found. Please run `/count channel` again.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await pool.query(
        `INSERT INTO counting (guild_id, channel_id, current)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE current = VALUES(current)`,
        [interaction.guildId, countingChannelId, number]
      );

      await countingChannel.send(`${interaction.user} has set the count to **${number}**!`);
      await interaction.reply({ content: `<:checkmark:1495875811792781332> Current count set to **${number}**.`, flags: MessageFlags.Ephemeral });
    }
  }
};
