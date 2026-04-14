const { MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const DEFAULT_REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
];

const FRIENDLY_PERMISSION_NAMES = {
  ViewChannel: 'View Channel',
  SendMessages: 'Send Messages',
  EmbedLinks: 'Embed Links',
  ManageMessages: 'Manage Messages',
  ManageChannels: 'Manage Channels',
  ManageRoles: 'Manage Roles',
  ManageGuild: 'Manage Server',
  CreateInstantInvite: 'Create Invite',
  MentionEveryone: 'Mention Everyone',
  UseExternalEmojis: 'Use External Emojis',
  AddReactions: 'Add Reactions'
};

function resolveRequiredPermissions(command, interaction) {
  if (!command) return [...DEFAULT_REQUIRED_PERMISSIONS];

  if (typeof command.requiredBotPermissions === 'function') {
    const resolved = command.requiredBotPermissions(interaction);
    return Array.isArray(resolved) && resolved.length ? resolved : [...DEFAULT_REQUIRED_PERMISSIONS];
  }

  if (Array.isArray(command.requiredBotPermissions) && command.requiredBotPermissions.length) {
    return command.requiredBotPermissions;
  }

  return [...DEFAULT_REQUIRED_PERMISSIONS];
}

function getBotPermissionsInChannel(interaction) {
  if (!interaction.inGuild()) {
    return null;
  }

  if (interaction.appPermissions) {
    return interaction.appPermissions;
  }

  if (!interaction.guild || !interaction.channel || !interaction.client?.user) {
    return null;
  }

  return interaction.channel.permissionsFor(interaction.client.user) || null;
}

function getMissingPermissions(interaction, requiredPermissions) {
  const botPermissions = getBotPermissionsInChannel(interaction);
  if (!botPermissions) return [];

  return requiredPermissions.filter(permission => !botPermissions.has(permission));
}

function toPermissionNames(permissions) {
  return permissions.map(permission => {
    const bitfieldPermission = new PermissionsBitField(permission);
    const [rawName] = bitfieldPermission.toArray();
    return FRIENDLY_PERMISSION_NAMES[rawName] || rawName || String(permission);
  });
}

async function replyMissingPermissions(interaction, missingPermissions) {
  const names = toPermissionNames(missingPermissions);
  const message = `❌ I don't have the required permissions for this action: ${names.join(', ')}.`;

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
}

function isMissingPermissionsError(error) {
  if (!error) return false;

  return error.code === 50013
    || error.code === 50001
    || error.message?.toLowerCase().includes('missing permissions');
}

module.exports = {
  resolveRequiredPermissions,
  getMissingPermissions,
  replyMissingPermissions,
  isMissingPermissionsError,
  DEFAULT_REQUIRED_PERMISSIONS
};
