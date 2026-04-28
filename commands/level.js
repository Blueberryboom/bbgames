const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { query } = require('../database');
const { xpForNextLevel, progressBar, getGuildLevelingSettings } = require('../utils/levelingSystem');
const { guildHasPremiumPerks } = require('../utils/premiumPerks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('View your level card or a leaderboard')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to check')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('leaderboard')
        .setDescription('Show leaderboard instead of a user card')
        .setRequired(false)
        .addChoices(
          { name: '7 day', value: '7d' },
          { name: 'month', value: 'month' },
          { name: 'all time', value: 'all' }
        )
    ),

  async execute(interaction) {
    try {
      const settings = await getGuildLevelingSettings(interaction.guildId);
      if (!settings.enabled) {
        return interaction.reply({
          content: '⚠️ Leveling is currently disabled in this server. Run `/leveling config` to activate it.',
          flags: MessageFlags.Ephemeral
        });
      }

      const boardType = interaction.options.getString('leaderboard');
      if (boardType) {
        return showLeaderboard(interaction, boardType);
      }


      const premiumEnabled = await guildHasPremiumPerks(interaction.client, interaction.guildId);
      if (!premiumEnabled) {
        const rewardRows = await query(
          `SELECT COUNT(*) AS total
           FROM leveling_role_rewards
           WHERE guild_id = ?`,
          [interaction.guildId]
        );

        if (Number(rewardRows[0]?.total || 0) > 15) {
          return interaction.reply({
            content: '⚠️ Leveling is temporarily disabled in this server because more than 15 level reward roles are configured without premium perks. Reduce it to 15 or less.',
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const target = interaction.options.getUser('user') || interaction.user;
      const rows = await query(
        `SELECT xp, level
         FROM leveling_users
         WHERE guild_id = ? AND user_id = ?
         LIMIT 1`,
        [interaction.guildId, target.id]
      );

      const xp = Number(rows[0]?.xp || 0);
      const level = Number(rows[0]?.level || 0);
      const goal = xpForNextLevel(level);
      const currentInLevel = xp;

      const card = new EmbedBuilder()
        .setColor(0x4F8BFF)
        .setAuthor({ name: `${target.username}'s Level` })
        .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(`Level ${level}\n\`${progressBar(currentInLevel, goal)}\`\n${currentInLevel}/${goal} XP`)
        .setFooter({ text: 'Earn XP by chatting in allowed channels.' });

      return interaction.reply({ embeds: [card] });
    } catch (error) {
      console.error('⚠️ Level command failed:', error);
      return interaction.reply({
        content: '⚠️ Could not fetch level data right now.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

async function showLeaderboard(interaction, boardType) {
  const rows = await fetchLeaderboardRows(interaction, boardType);
  if (!rows.length) {
    return interaction.reply({ content: 'No leaderboard data yet.' });
  }

  const title = boardType === 'all'
    ? 'Level Leaderboard • All Time'
    : boardType === 'month'
      ? 'Level Leaderboard • 30 Days'
      : 'Level Leaderboard • 7 Days';

  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  let page = 0;
  const customBase = `level_board:${interaction.id}`;

  const buildEmbed = () => {
    const slice = rows.slice(page * perPage, (page + 1) * perPage);
    const lines = slice.map((row, index) => {
      const rank = page * perPage + index + 1;
      const valueText = boardType === 'all'
        ? `Level ${Number(row.level || 0)} (${Number(row.xp || 0)} XP)`
        : `${Number(row.total_xp || 0)} XP`;
      return `#${rank} <@${row.user_id}> - ${valueText}`;
    });

    return new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(title)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Page ${page + 1} / ${totalPages} • ${rows.length} users` });
  };

  const buildComponents = () => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customBase}:left`)
        .setLabel('⬅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1),
      new ButtonBuilder()
        .setCustomId(`${customBase}:me`)
        .setLabel('Find Me')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${customBase}:right`)
        .setLabel('➡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1)
    )
  ];

  const reply = await interaction.reply({
    embeds: [buildEmbed()],
    components: buildComponents()
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
      return i.update({ embeds: [buildEmbed()], components: buildComponents() });
    }

    if (i.customId.endsWith(':right')) {
      page = (page + 1) % totalPages;
      return i.update({ embeds: [buildEmbed()], components: buildComponents() });
    }

    const index = rows.findIndex(row => row.user_id === i.user.id);
    if (index === -1) {
      return i.reply({ content: 'You are not ranked on this leaderboard yet.', flags: MessageFlags.Ephemeral });
    }

    page = Math.floor(index / perPage);
    return i.update({ embeds: [buildEmbed()], components: buildComponents() });
  });

  collector.on('end', async () => {
    await message.edit({ components: [] }).catch(() => null);
  });

  return reply;
}

async function fetchLeaderboardRows(interaction, boardType) {
  if (boardType === 'all') {
    const memberIds = new Set((await interaction.guild.members.fetch()).map(member => member.id));
    const rows = await query(
      `SELECT user_id, level, xp
       FROM leveling_users
       WHERE guild_id = ?
       ORDER BY level DESC, xp DESC, user_id ASC`,
      [interaction.guildId]
    );

    return rows.filter(row => memberIds.has(row.user_id));
  }

  let where = '';
  const params = [interaction.guildId];

  if (boardType === '7d') {
    where = 'AND created_at >= ?';
    params.push(Date.now() - (7 * 24 * 60 * 60 * 1000));
  } else if (boardType === 'month') {
    where = 'AND created_at >= ?';
    params.push(Date.now() - (30 * 24 * 60 * 60 * 1000));
  }

  return query(
    `SELECT user_id, COALESCE(SUM(xp_gained), 0) AS total_xp
     FROM leveling_xp_events
     WHERE guild_id = ? ${where}
     GROUP BY user_id
     ORDER BY total_xp DESC, user_id ASC`,
    params
  );
}
