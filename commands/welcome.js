const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const welcomeSetupState = require('../utils/welcomeSetupState');
const { MESSAGE_TEMPLATES } = require('../utils/welcomeSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the server welcome system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where welcome messages are sent')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Pick one of the pre-made welcome messages')
        .setRequired(true)
        .addChoices(
          { name: '👋 Welcome @usermention! You\'re member #number on the server! :)', value: 'classic' },
          { name: 'Welcome to serverName, @usermention!', value: 'server_name' },
          { name: '🎉 Hype welcome (#number)', value: 'hype' },
          { name: '✨ Cozy welcome', value: 'cozy' },
          { name: '🕹️ Gamer welcome (#number)', value: 'gamer' }
        )
    )
    .addBooleanOption(option =>
      option
        .setName('image')
        .setDescription('Include a welcome image card')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('link_button_name')
        .setDescription('Optional button text for a link button')
        .setRequired(false)
        .setMaxLength(80)
    )
    .addStringOption(option =>
      option
        .setName('link_button')
        .setDescription('Optional URL for the welcome link button')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ You need the **Manage Server** permission to configure welcome messages.',
        flags: MessageFlags.Ephemeral
      });
    }

    const channel = interaction.options.getChannel('channel', true);
    const messageKey = interaction.options.getString('message', true);
    const imageEnabled = interaction.options.getBoolean('image', true);
    const buttonLabel = interaction.options.getString('link_button_name');
    const buttonUrl = interaction.options.getString('link_button');

    if ((buttonLabel && !buttonUrl) || (!buttonLabel && buttonUrl)) {
      return interaction.reply({
        content: '❌ To add a link button, provide both **Link button name** and **Link button** URL.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (buttonUrl) {
      let parsed;
      try {
        parsed = new URL(buttonUrl);
      } catch {
        return interaction.reply({ content: '❌ Link button must be a valid URL.', flags: MessageFlags.Ephemeral });
      }

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return interaction.reply({ content: '❌ Link button URL must start with http:// or https://.', flags: MessageFlags.Ephemeral });
      }
    }

    const token = welcomeSetupState.create({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      channelId: channel.id,
      messageKey,
      imageEnabled,
      buttonLabel: buttonLabel || null,
      buttonUrl: buttonUrl || null
    });

    const settingsSummary = new EmbedBuilder()
      .setColor(0x4F8BFF)
      .setTitle('Review Welcome Setup')
      .setDescription('You can send a test message first, then confirm to save this configuration.')
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Image', value: imageEnabled ? 'Yes' : 'No', inline: true },
        { name: 'Message', value: MESSAGE_TEMPLATES[messageKey] || MESSAGE_TEMPLATES.classic },
        { name: 'Link Button', value: buttonLabel && buttonUrl ? `[${buttonLabel}](${buttonUrl})` : 'Not set' }
      )
      .setFooter({ text: 'This preview expires in 10 minutes.' });

    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`welcome_test_${token}`)
        .setLabel('Send Test')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`welcome_confirm_${token}`)
        .setLabel('Confirm & Save')
        .setStyle(ButtonStyle.Success)
    );

    return interaction.reply({
      embeds: [settingsSummary],
      components: [controls],
      flags: MessageFlags.Ephemeral
    });
  }
};
