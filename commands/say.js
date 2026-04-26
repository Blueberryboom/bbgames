const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const checkPerms = require('../utils/checkEventPerms');
const { LOG_EVENT_KEYS, logGuildEvent } = require('../utils/guildLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send a message in this channel')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The message for the bot to send')
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addBooleanOption(option =>
      option
        .setName('embed')
        .setDescription('Send as an embed? (yes/no)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '<:warning:1496193692099285255> You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const message = interaction.options.getString('message', true).trim();
    const useEmbed = interaction.options.getBoolean('embed') ?? false;

    if (useEmbed) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setDescription(message);

      await interaction.channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });
    } else {
      await interaction.channel.send({
        content: message,
        allowedMentions: { parse: [] }
      });
    }

    await logGuildEvent(
      interaction.client,
      interaction.guildId,
      LOG_EVENT_KEYS.say_command_used,
      `🗣️ **/say used:** <@${interaction.user.id}> used /say in <#${interaction.channelId}>.`
    );

    return interaction.reply({
      content: '<:checkmark:1495875811792781332> Message sent.',
      flags: MessageFlags.Ephemeral
    });
  }
};
