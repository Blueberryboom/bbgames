const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const EVENT_TYPES = {
  welcome: 'welcome',
  leave: 'leave',
  boost: 'boost'
};

const DEFAULT_MESSAGES = {
  [EVENT_TYPES.welcome]: '👋 Welcome [$usermention] to [$guildname]!',
  [EVENT_TYPES.leave]: 'Goodbye, [$usermention], hope to see you again soon!',
  [EVENT_TYPES.boost]: 'Thanks [$usermention] for boosting [$guildname]'
};

function renderMessage(template, memberOrUser, guild) {
  const userMention = memberOrUser?.id ? `<@${memberOrUser.id}>` : 'a user';
  const memberCount = String(guild?.memberCount ?? 0);
  const guildName = guild?.name || 'this server';

  return String(template || '')
    .replaceAll('[$usermention]', userMention)
    .replaceAll('[$membercount]', memberCount)
    .replaceAll('[$guildname]', guildName);
}

function buildMemberEventPayload(eventType, memberOrUser, guild, settings) {
  const template = settings?.message_template || DEFAULT_MESSAGES[eventType] || DEFAULT_MESSAGES.welcome;
  const content = renderMessage(template, memberOrUser, guild);
  const components = [];

  if (settings?.button_label && settings?.button_url) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(settings.button_label)
          .setURL(settings.button_url)
      )
    );
  }

  return {
    content,
    components,
    allowedMentions: { users: memberOrUser?.id ? [memberOrUser.id] : [] }
  };
}

module.exports = {
  EVENT_TYPES,
  DEFAULT_MESSAGES,
  renderMessage,
  buildMemberEventPayload
};
