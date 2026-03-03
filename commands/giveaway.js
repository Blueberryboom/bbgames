const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const pool = require('../database/index'); // your DB pool
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const checkPerms = require('../utils/checkEventPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(sub => 
      sub.setName('create')
        .setDescription('Create a new giveaway')
        .addStringOption(opt => opt.setName('prize').setDescription('Prize of the giveaway').setRequired(true))
        .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g., 2d 6h 30m)').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Custom title for embed'))
        .addRoleOption(opt => opt.setName('required_role').setDescription('Role required to join')))
    .addSubcommand(sub => sub.setName('list').setDescription('List active giveaways'))
    .addSubcommand(sub => sub.setName('end').setDescription('End a giveaway early').addStringOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a giveaway').addStringOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('reroll').setDescription('Reroll winners').addStringOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true))),

  async execute(interaction) {
    try {
      if (!await checkPerms(interaction)) 
        return interaction.reply({ content: "❌ No permission", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === 'create') {
        const prize = interaction.options.getString('prize');
        const winners = interaction.options.getInteger('winners');
        const durationInput = interaction.options.getString('duration');
        const customTitle = interaction.options.getString('title');
        const requiredRole = interaction.options.getRole('required_role');

        // Parse duration
        let durationMs;
        try {
          durationMs = parseDuration(durationInput);
        } catch {
          return interaction.reply({ content: '❌ Invalid duration format.', ephemeral: true });
        }

        const giveawayId = uuidv4();
        const endTime = Date.now() + durationMs;

        // Insert giveaway into DB
        await pool.query(`INSERT INTO giveaways 
          (id, guild_id, channel_id, message_id, host_id, prize, winners, end_time, required_role, title) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [giveawayId, interaction.guild.id, interaction.channel.id, '0', interaction.user.id, prize, winners, endTime, requiredRole?.id || null, customTitle || null]
        );

        // Create embed
        const embed = new EmbedBuilder()
          .setColor('#7289DA') // burple
          .setTitle(customTitle || '🎉 Giveaway!')
          .addFields(
            { name: 'Prize', value: prize },
            { name: 'Winners', value: winners.toString(), inline: true },
            { name: 'Ends', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
            { name: 'Required Role', value: requiredRole ? `<@&${requiredRole.id}>` : 'None', inline: true },
            { name: 'Giveaway ID', value: giveawayId }
          )
          .setFooter({ text: `Hosted by ${interaction.user.tag}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel('Join').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`giveaway_participants_${giveawayId}`).setLabel('Participants').setStyle(ButtonStyle.Secondary)
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

        // Update message_id in DB
        await pool.query(`UPDATE giveaways SET message_id = ? WHERE id = ?`, [msg.id, giveawayId]);

        return interaction.reply({ content: `✅ Giveaway created!`, ephemeral: true });
      }

      if (sub === 'list') {
        const [giveaways] = await pool.query(`SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY end_time ASC`, [interaction.guild.id]);
        if (!giveaways.length) return interaction.reply({ content: 'No active giveaways.', ephemeral: true });

        const embeds = giveaways.map(g => new EmbedBuilder()
          .setTitle(g.title || '🎉 Giveaway')
          .setColor('#7289DA')
          .addFields(
            { name: 'Prize', value: g.prize },
            { name: 'Giveaway ID', value: g.id }
          )
        );

        return interaction.reply({ embeds: embeds.slice(0, 10), ephemeral: true }); // basic pagination: first 10
      }

      // The other subcommands: end, delete, reroll
      const giveawayId = interaction.options.getString('id');
      const [rows] = await pool.query(`SELECT * FROM giveaways WHERE id = ?`, [giveawayId]);
      if (!rows.length) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
      const giveaway = rows[0];

      if (sub === 'end') {
        // Call your endGiveaway function (to be implemented in giveawayManager)
        await require('../utils/giveawayManager').endGiveaway(interaction.client, giveaway);
        return interaction.reply({ content: `✅ Giveaway ended.`, ephemeral: true });
      }

      if (sub === 'delete') {
        await pool.query(`DELETE FROM giveaways WHERE id = ?`, [giveawayId]);
        await pool.query(`DELETE FROM giveaway_entries WHERE giveaway_id = ?`, [giveawayId]);
        return interaction.reply({ content: `✅ Giveaway deleted.`, ephemeral: true });
      }

      if (sub === 'reroll') {
        await require('../utils/giveawayManager').rerollGiveaway(interaction.client, giveaway);
        return interaction.reply({ content: `✅ Giveaway rerolled.`, ephemeral: true });
      }

    } catch (err) {
      console.error(err);
      if (!interaction.replied && !interaction.deferred)
        await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
};

// Helper: parse d/h/m format into milliseconds
function parseDuration(input) {
  const regex = /(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/i;
  const match = regex.exec(input);
  if (!match) throw new Error('Invalid duration');

  const days = parseInt(match[1] || '0');
  const hours = parseInt(match[2] || '0');
  const minutes = parseInt(match[3] || '0');

  if (days === 0 && hours === 0 && minutes === 0) throw new Error('Duration too short');
  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}
