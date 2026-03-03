const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const { v4: uuidv4 } = require('uuid');
const checkPerms = require('../utils/checkEventPerms');
const giveawayManager = require('../utils/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a giveaway')
        .addStringOption(o => o.setName('prize').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setRequired(true))
        .addStringOption(o => o.setName('duration').setRequired(true))
        .addStringOption(o => o.setName('title'))
        .addRoleOption(o => o.setName('required_role'))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List active giveaways'))
    .addSubcommand(sub => sub.setName('end').addStringOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').addStringOption(o => o.setName('id').setRequired(true)))
    .addSubcommand(sub => sub.setName('reroll').addStringOption(o => o.setName('id').setRequired(true))),

  async execute(interaction) {

    if (!await checkPerms(interaction))
      return interaction.reply({ content: "❌ No permission", flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();

    // ─────────────────────────
    // CREATE
    // ─────────────────────────
    if (sub === 'create') {

      const prize = interaction.options.getString('prize');
      const winners = interaction.options.getInteger('winners');
      const durationInput = interaction.options.getString('duration');
      const title = interaction.options.getString('title');
      const requiredRole = interaction.options.getRole('required_role');

      const durationMs = parseDuration(durationInput);
      const endTime = Date.now() + durationMs;
      const id = uuidv4();

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(title || '🎉 Giveaway')
        .setDescription(
          `**Prize:** ${prize}\n` +
          `**Winners:** ${winners}\n\n` +
          (requiredRole ? `🔒 **Required Role:** <@&${requiredRole.id}>\n` : '') +
          `⏰ **Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\n` +
          `🆔 **ID:** \`${id}\``
        )
        .setFooter({ text: `Hosted by ${interaction.user.tag}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_join_${id}`)
          .setLabel('Join')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`giveaway_participants_${id}`)
          .setLabel('Participants (0)')
          .setStyle(ButtonStyle.Secondary)
      );

      const msg = await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      await giveawayManager.createGiveaway(interaction.client, {
        id,
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        messageId: msg.id,
        prize,
        winners,
        endTime,
        requiredRole: requiredRole?.id || null,
        title
      });

      return interaction.reply({
        content: '✅ Giveaway created!',
        flags: MessageFlags.Ephemeral
      });
    }

    // ─────────────────────────
    // LIST
    // ─────────────────────────
    if (sub === 'list') {

      const giveaways = await giveawayManager.listActiveGiveaways(interaction.guild.id);

      if (!giveaways.length)
        return interaction.reply({
          content: 'No active giveaways.',
          flags: MessageFlags.Ephemeral
        });

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎉 Active Giveaways')
        .setDescription(
          giveaways.map(g =>
            `• **${g.prize}**\n🆔 \`${g.id}\`\nEnds <t:${Math.floor(g.end_time / 1000)}:R>\n`
          ).join('\n')
        );

      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }

    const id = interaction.options.getString('id');

    if (sub === 'end') {
      await giveawayManager.endGiveaway(interaction.client, id);
      return interaction.reply({ content: '✅ Giveaway ended.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete') {
      await giveawayManager.deleteGiveaway(interaction.client, id);
      return interaction.reply({ content: '✅ Giveaway deleted.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'reroll') {
      await giveawayManager.rerollGiveaway(interaction.client, id);
      return interaction.reply({ content: '✅ Giveaway rerolled.', flags: MessageFlags.Ephemeral });
    }
  }
};

function parseDuration(input) {
  const regex = /(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/i;
  const match = regex.exec(input);
  if (!match) throw new Error('Invalid duration');

  const days = parseInt(match[1] || '0');
  const hours = parseInt(match[2] || '0');
  const minutes = parseInt(match[3] || '0');

  if (days === 0 && hours === 0 && minutes === 0)
    throw new Error('Duration too short');

  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}
