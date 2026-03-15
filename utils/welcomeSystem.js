const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const MESSAGE_TEMPLATES = {
  classic: '👋 Welcome @usermention! You\'re member **#number** on the server! :)',
  server_name: 'Welcome to **serverName**, @usermention!',
  hype: '🎉 Hey @usermention, great to have you in **serverName**! You\'re our **#number** member!',
  cozy: '✨ Make yourself at home, @usermention. Welcome to **serverName**!',
  gamer: '🕹️ @usermention joined the lobby! Welcome to **serverName** — member **#number**.'
};

function resolveTemplateMessage(templateKey, member, guild) {
  const template = MESSAGE_TEMPLATES[templateKey] || MESSAGE_TEMPLATES.classic;

  return template
    .replaceAll('@usermention', `<@${member.id}>`)
    .replaceAll('serverName', guild.name)
    .replaceAll('#number', `#${guild.memberCount}`);
}

function buildWelcomePayload(member, guild, settings) {
  const content = resolveTemplateMessage(settings.message_key, member, guild);
  const components = [];

  if (settings.button_label && settings.button_url) {
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
    allowedMentions: { users: [member.id] }
  };
}

module.exports = {
  MESSAGE_TEMPLATES,
  buildWelcomePayload
};
