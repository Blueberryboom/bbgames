const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
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
    .replaceAll('#number', String(guild.memberCount));
}

function createWelcomeCardSvg(member, guild) {
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const username = escapeXml(member.user.username);
  const serverName = escapeXml(guild.name);

  return `
<svg width="1100" height="500" viewBox="0 0 1100 500" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1100" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#113A8F"/>
      <stop offset="1" stop-color="#1C4DB8"/>
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="42" />
    </filter>
    <clipPath id="avatarClip">
      <circle cx="550" cy="138" r="72" />
    </clipPath>
  </defs>

  <rect width="1100" height="500" fill="url(#bg)"/>

  <path d="M-50 350 Q 250 250 520 360 T 1150 340 L 1150 560 L -50 560 Z" fill="#FF8D2F" filter="url(#blur)" opacity="0.72"/>
  <path d="M-60 380 Q 220 290 500 385 T 1160 360 L 1160 560 L -60 560 Z" fill="#4D8BFF" filter="url(#blur)" opacity="0.58"/>

  <circle cx="550" cy="138" r="78" fill="#ffffff" fill-opacity="0.25"/>
  <image href="${avatarUrl}" x="478" y="66" width="144" height="144" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />

  <text x="550" y="280" text-anchor="middle" font-size="52" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="white">${username}</text>
  <text x="550" y="344" text-anchor="middle" font-size="44" font-family="Arial, Helvetica, sans-serif" fill="#EAF2FF">Welcome to ${serverName}!</text>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildWelcomePayload(member, guild, settings, { isTest = false } = {}) {
  const content = resolveTemplateMessage(settings.message_key, member, guild);
  const embeds = [];
  const files = [];
  const components = [];

  if (settings.image_enabled) {
    const svg = createWelcomeCardSvg(member, guild);
    files.push(new AttachmentBuilder(Buffer.from(svg, 'utf8'), { name: 'welcome-card.svg' }));

    const imageEmbed = new EmbedBuilder()
      .setColor(0x4F8BFF)
      .setTitle(isTest ? 'Welcome Preview' : 'Welcome!')
      .setImage('attachment://welcome-card.svg');

    if (isTest) imageEmbed.setDescription('This is a test welcome message preview.');

    embeds.push(imageEmbed);
  }

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
    embeds,
    files,
    components,
    allowedMentions: { users: [member.id] }
  };
}

module.exports = {
  MESSAGE_TEMPLATES,
  buildWelcomePayload
};
