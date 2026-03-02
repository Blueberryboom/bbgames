const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const { parseDuration, endGiveaway } = require('../utils/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(s =>
      s.setName('create')
        .setDescription('Create a giveaway')
        .addStringOption(o => o.setName('prize').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setRequired(true))
        .addStringOption(o => o.setName('duration').setRequired(true))
        .addRoleOption(o => o.setName('required_role'))
        .addStringOption(o => o.setName('title')))
    .addSubcommand(s =>
      s.setName('end')
        .addStringOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(s =>
      s.setName('reroll')
        .addStringOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(s =>
      s.setName('delete')
        .addStringOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(s =>
      s.setName('list')),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === 'create') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
          return interaction.reply({ content: 'Missing permission.', flags: 64 });

        const prize = interaction.options.getString('prize');
        const winners = interaction.options.getInteger('winners');
        const durationInput = interaction.options.getString('duration');
        const requiredRole = interaction.options.getRole('required_role');
        const title = interaction.options.getString('title');

        const duration = parseDuration(durationInput);
        if (!duration)
          return interaction.reply({ content: 'Invalid duration format.', flags: 64 });

        const endTime = Date.now() + duration;
        const id = uuidv4();

        const embed = new EmbedBuilder()
          .setTitle(title || '🎉 Giveaway')
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}`)
          .addFields({ name: 'Ends', value: `<t:${Math.floor(endTime/1000)}:R>` })
          .setFooter({ text: `ID: ${id}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`gw_join_${id}`)
            .setLabel('Enter Giveaway (0)')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`gw_list_${id}`)
            .setLabel('Participants')
            .setStyle(ButtonStyle.Secondary)
        );

        const msg = await interaction.reply({
          embeds: [embed],
          components: [row],
          fetchReply: true
        });

        await pool.query(
          `INSERT INTO giveaways VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [id, interaction.guild.id, interaction.channel.id, msg.id,
            prize, winners, requiredRole?.id || null,
            title || null, endTime]
        );

        return;
      }

      if (sub === 'end') {
        await endGiveaway(interaction.client,
          interaction.options.getString('id'));
        return interaction.reply({ content: 'Ended.', flags: 64 });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id');
        await pool.query(`DELETE FROM giveaways WHERE id=?`, [id]);
        await pool.query(`DELETE FROM giveaway_entries WHERE giveaway_id=?`, [id]);
        return interaction.reply({ content: 'Deleted.', flags: 64 });
      }

      if (sub === 'list') {
        const [rows] = await pool.query(
          `SELECT * FROM giveaways WHERE guild_id=? AND ended=0`,
          [interaction.guild.id]
        );

        if (!rows.length)
          return interaction.reply({ content: 'No active giveaways.', flags: 64 });

        const embed = new EmbedBuilder()
          .setTitle('Active Giveaways')
          .setDescription(rows.map(g =>
            `**${g.prize}**\nID: ${g.id}\nEnds: <t:${Math.floor(g.end_time/1000)}:R>`
          ).join('\n\n'));

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

    } catch (err) {
      return interaction.reply({ content: `Error: ${err.message}`, flags: 64 });
    }
  }
};
