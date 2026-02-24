const { SlashCommandBuilder } = require('discord.js');

const BOT_OWNER = "1056523021894029372";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message to any server channel (Owner only)')
    .addStringOption(o =>
      o.setName('guild')
        .setDescription('Guild ID')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('channel')
        .setDescription('Channel ID')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Message to send')
        .setRequired(true)
    ),

  async execute(interaction) {

    // ─── MUST BE DM ───────────────────────────
    if (interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in DMs.",
        ephemeral: true
      });
    }

    // ─── OWNER CHECK ──────────────────────────
    if (interaction.user.id !== BOT_OWNER) {
      return interaction.reply({
        content: "❌ You are not allowed to use this.",
        ephemeral: true
      });
    }

    const guildId = interaction.options.getString('guild');
    const channelId = interaction.options.getString('channel');
    const messageContent = interaction.options.getString('message');

    await interaction.reply({
      content: "📡 Sending message...",
      ephemeral: true
    });

    // ─── SHARD SAFE SEND ──────────────────────
    const results = await interaction.client.shard.broadcastEval(
      async (client, { guildId, channelId, messageContent }) => {

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) return false;

        await channel.send(messageContent);
        return true;

      },
      {
        context: { guildId, channelId, messageContent }
      }
    );

    const success = results.some(Boolean);

    await interaction.editReply({
      content: success
        ? "✅ Message sent successfully!"
        : "❌ Could not find guild/channel."
    });
  }
};
