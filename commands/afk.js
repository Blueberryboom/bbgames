const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { setAfk } = require('../utils/afkManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Why you are AFK')
        .setRequired(false)
        .setMaxLength(200)
    )
    .addBooleanOption(option =>
      option
        .setName('only_this_server')
        .setDescription('Only show AFK in this server? (Yes = local, No = global)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '⚠️ You can only use `/afk` inside a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      const reason = interaction.options.getString('reason') || 'No reason provided.';
      const onlyThisServer = interaction.options.getBoolean('only_this_server') ?? false;

      await setAfk(interaction.user.id, interaction.guildId, reason, onlyThisServer);

      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setDescription(
          `💤 ${interaction.user} is now AFK.\n**Reason:** *${reason}*`
        )
        .setFooter({
          text: onlyThisServer ? 'Scope: This server only' : 'Scope: All servers'
        });

      return interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('⚠️ /afk failed:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '⚠️ Failed to set AFK status. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.followUp({
        content: '⚠️ Failed to set AFK status. Please try again.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
