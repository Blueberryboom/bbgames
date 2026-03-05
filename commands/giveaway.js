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

    // ─────────────────────────
    // CREATE
    // ─────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a giveaway')
        .addStringOption(o =>
          o.setName('prize')
            .setDescription('The prize for the giveaway')
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName('winners')
            .setDescription('Number of winners')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('duration')
            .setDescription('Duration (example: 1d 2h 30m)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('title')
            .setDescription('Optional custom giveaway title')
            .setRequired(false)
        )
        .addRoleOption(o =>
          o.setName('required_role')
            .setDescription('Role required to enter the giveaway')
            .setRequired(false)
        )
    )

    // ─────────────────────────
    // LIST
    // ─────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List active giveaways')
    )

    // ─────────────────────────
    // END
    // ─────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('End a giveaway early')
        .addStringOption(o =>
          o.setName('id')
            .setDescription('The giveaway ID')
            .setRequired(true)
        )
    )

    // ─────────────────────────
    // DELETE
    // ─────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a giveaway permanently')
        .addStringOption(o =>
          o.setName('id')
            .setDescription('The giveaway ID')
            .setRequired(true)
        )
    )

    // ─────────────────────────
    // REROLL
    // ─────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('reroll')
        .setDescription('Reroll a finished giveaway')
        .addStringOption(o =>
          o.setName('id')
            .setDescription('The giveaway ID')
            .setRequired(true)
        )
    ),

  async execute(interaction) {

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: "❌ You do not have permission to use this.",
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    // ─────────────────────────
    // CREATE
    // ─────────────────────────
    if (sub === 'create') {

      const prize = interaction.options.getString('prize').trim();
      const winners = interaction.options.getInteger('winners');
      const durationInput = interaction.options.getString('duration');
      const title = interaction.options.getString('title');
      const requiredRole = interaction.options.getRole('required_role');

      if (winners < 1 || winners > 20) {
        return interaction.reply({
          content: '❌ Winners must be between 1 and 20.',
          flags: MessageFlags.Ephemeral
        });
      }

      let durationMs;
      try {
        durationMs = parseDuration(durationInput);
      } catch {
        return interaction.reply({
          content: '❌ Invalid duration. Example formats: `30m`, `2h`, `1d 2h 30m`.',
          flags: MessageFlags.Ephemeral
        });
      }

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
        hostId: interaction.user.id,
        prize,
        winners,
        endTime,
        requiredRole: requiredRole?.id || null,
        title
      });

      return interaction.reply({
        content: '✅ Giveaway created successfully!',
        flags: MessageFlags.Ephemeral
      });
    }

    // ─────────────────────────
    // LIST
    // ─────────────────────────
    if (sub === 'list') {

      const giveaways = await giveawayManager.listActiveGiveaways(interaction.guild.id);

      if (!giveaways.length) {
        return interaction.reply({
          content: 'There are no active giveaways.',
          flags: MessageFlags.Ephemeral
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎉 Active Giveaways')
        .setDescription(
          giveaways.map(g =>
            `• **${g.prize}**\n🆔 \`${g.id}\`\nEnds <t:${Math.floor(Number(g.end_time) / 1000)}:R>\n`
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
  const regex = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*$/i;
  const match = regex.exec(input);

  if (!match) throw new Error('Invalid duration');

  const days = parseInt(match[1] || '0');
  const hours = parseInt(match[2] || '0');
  const minutes = parseInt(match[3] || '0');

  if (days === 0 && hours === 0 && minutes === 0)
    throw new Error('Duration too short');

  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}
