const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tags')
    .setDescription('Tag analytics tools')
    .addSubcommand(sub =>
      sub
        .setName('usage')
        .setDescription('Show most used tags (admin only)')
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    const rows = await query(
      `SELECT t.tag_name,
              COALESCE(all_time.total, 0) AS all_time_usage,
              COALESCE(last_7.total, 0) AS week_usage
       FROM tags t
       LEFT JOIN (
         SELECT guild_id, tag_name, COUNT(*) AS total
         FROM tag_usage_stats
         WHERE guild_id = ?
         GROUP BY guild_id, tag_name
       ) all_time ON all_time.guild_id = t.guild_id AND all_time.tag_name = t.tag_name
       LEFT JOIN (
         SELECT guild_id, tag_name, COUNT(*) AS total
         FROM tag_usage_stats
         WHERE guild_id = ? AND used_at >= ?
         GROUP BY guild_id, tag_name
       ) last_7 ON last_7.guild_id = t.guild_id AND last_7.tag_name = t.tag_name
       WHERE t.guild_id = ?
       ORDER BY all_time_usage DESC, week_usage DESC, t.tag_name ASC
       LIMIT 10`,
      [interaction.guildId, interaction.guildId, sevenDaysAgo, interaction.guildId]
    );

    if (!rows.length) {
      return interaction.reply({
        content: '📭 No tags found in this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏷️ Tag Usage Leaderboard')
      .setDescription('Top 10 most used tags')
      .addFields(
        rows.map((row, idx) => ({
          name: `#${idx + 1} • ${row.tag_name}`,
          value: `All time usage: **${Number(row.all_time_usage || 0)}**\nPast 7 days usage: **${Number(row.week_usage || 0)}**`
        }))
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
