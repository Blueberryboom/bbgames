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
          : '❌ Counting not set up'
      );
      return;
    }

    if (subcommand === 'channel') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = interaction.options.getChannel('channel');

      if (!channel || channel.guildId !== interaction.guildId || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: '❌ Please select a valid text channel from this server.',
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

      await interaction.reply(`✅ Counting channel set to ${channel}`);
      return;
    }

    if (subcommand === 'removechannel') {
      if (!await checkPerms(interaction)) {
        await interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: '❌ No permission', flags: MessageFlags.Ephemeral });
        return;
      }

      const number = interaction.options.getInteger('number', true);

      const [existing] = await pool.query(
        'SELECT channel_id FROM counting WHERE guild_id = ?',
        [interaction.guildId]
      );

      await pool.query(
        `INSERT INTO counting (guild_id, channel_id, current)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE current = VALUES(current)`,
        [interaction.guildId, existing?.channel_id ?? null, number]
      );

      await interaction.reply(`✅ Current count set to **${number}**.`);
    }
  }
};
