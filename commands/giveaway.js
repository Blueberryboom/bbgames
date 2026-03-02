const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');

const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const { parseDuration, endGiveaway } = require('../utils/giveawayManager');

async function hasAdminPermission(interaction) {
  // Check database for configured admin roles
  const [rows] = await pool.query(
    `SELECT role_id FROM admin_roles WHERE guild_id=?`,
    [interaction.guild.id]
  );

  if (!rows.length) {
    // Fallback to ManageGuild if no admin roles configured
    return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  return rows.some(r => interaction.member.roles.cache.has(r.role_id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(s =>
      s.setName('create')
        .setDescription('Create a giveaway')
        .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('e.g. 1h, 30m').setRequired(true))
        .addRoleOption(o => o.setName('required_role').setDescription('Required role to enter'))
        .addStringOption(o => o.setName('title').setDescription('Custom giveaway title')))
    .addSubcommand(s =>
      s.setName('end')
        .setDescription('End a giveaway')
        .addStringOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('reroll')
        .setDescription('Reroll a giveaway')
        .addStringOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Delete a giveaway')
        .addStringOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List active giveaways')),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();

      // =============================
      // CREATE
      // =============================
      if (sub === 'create') {

        if (!(await hasAdminPermission(interaction)))
          return interaction.reply({ content: 'You do not have permission to create giveaways.', flags: 64 });

        const prize = interaction.options.getString('prize');
        const winners = interaction.options.getInteger('winners');
        const durationInput = interaction.options.getString('duration');
        const requiredRole = interaction.options.getRole('required_role');
        const title = interaction.options.getString('title');

        const duration = parseDuration(durationInput);
        if (!duration)
          return interaction.reply({ content: 'Invalid duration format. Example: 1h, 30m, 1d', flags: 64 });

        const endTime = Date.now() + duration;
        const id = uuidv4();

        const embed = new EmbedBuilder()
          .setTitle(title || '🎉 Giveaway')
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}`)
          .addFields({
            name: 'Ends',
            value: `<t:${Math.floor(endTime / 1000)}:R>`
          })
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
          [
            id,
            interaction.guild.id,
            interaction.channel.id,
            msg.id,
            prize,
            winners,
            requiredRole?.id || null,
            title || null,
            endTime
          ]
        );

        return;
      }

      // =============================
      // END
      // =============================
      if (sub === 'end') {

        if (!(await hasAdminPermission(interaction)))
          return interaction.reply({ content: 'You do not have permission to end giveaways.', flags: 64 });

        await endGiveaway(interaction.client, interaction.options.getString('id'));
        return interaction.reply({ content: 'Giveaway ended.', flags: 64 });
      }

      // =============================
      // REROLL
      // =============================
      if (sub === 'reroll') {

        if (!(await hasAdminPermission(interaction)))
          return interaction.reply({ content: 'You do not have permission to reroll giveaways.', flags: 64 });

        await endGiveaway(interaction.client, interaction.options.getString('id'), true);
        return interaction.reply({ content: 'Giveaway rerolled.', flags: 64 });
      }

      // =============================
      // DELETE
      // =============================
      if (sub === 'delete') {

        if (!(await hasAdminPermission(interaction)))
          return interaction.reply({ content: 'You do not have permission to delete giveaways.', flags: 64 });

        const id = interaction.options.getString('id');

        await pool.query(`DELETE FROM giveaways WHERE id=?`, [id]);
        await pool.query(`DELETE FROM giveaway_entries WHERE giveaway_id=?`, [id]);

        return interaction.reply({ content: 'Giveaway deleted.', flags: 64 });
      }

      // =============================
      // LIST
      // =============================
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
            `**${g.prize}**\nID: ${g.id}\nEnds: <t:${Math.floor(g.end_time / 1000)}:R>`
          ).join('\n\n'));

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

    } catch (err) {
      console.error(err);
      if (!interaction.replied)
        return interaction.reply({ content: `Error: ${err.message}`, flags: 64 });
    }
  }
};
