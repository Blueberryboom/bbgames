const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { getAfkLeaderboard, formatDuration } = require('../utils/afkManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk_leaderboard')
    .setDescription('Show global leaderboard for AFK stats (all servers)'),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '⚠️ This command can only be used inside a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      const rows = await getAfkLeaderboard(interaction.guildId, 500);
      if (!rows.length) {
        return interaction.reply('📭 No AFK leaderboard data yet. Only all-server AFKs are tracked here once users return from AFK.');
      }

      const perPage = 10;
      const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
      let page = 0;
      const customBase = `afk_board:${interaction.id}`;

      const buildEmbed = () => {
        const pageRows = rows.slice(page * perPage, (page + 1) * perPage);
        const description = pageRows
          .map((row, index) => {
            const rank = page * perPage + index + 1;
            return `**#${rank}** <@${row.user_id}>\n➤ Longest AFK: **${formatDuration(Number(row.longest_afk_ms || 0))}**\n➤ Total AFK: **${formatDuration(Number(row.total_afk_ms || 0))}**\n➤ AFK Sessions: **${Number(row.afk_sessions || 0)}**`;
          })
          .join('\n\n');

        return new EmbedBuilder()
          .setTitle('🏆 AFK Leaderboard')
          .setColor(0x5865F2)
          .setDescription(description)
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

      await interaction.reply({ embeds: [buildEmbed()], components: buildComponents() });
      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000
      });

      collector.on('collect', async i => {
        if (!i.customId.startsWith(customBase)) return;

        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: '⚠️ This leaderboard session is only for the user who opened it.',
            flags: MessageFlags.Ephemeral
          });
        }

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

      return;
    } catch (error) {
      console.error('⚠️ /afk_leaderboard failed:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '⚠️ Failed to load AFK leaderboard.',
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.followUp({
        content: '⚠️ Failed to load AFK leaderboard.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
