const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const youtubeSetupState = require('../utils/youtubeSetupState');

const MAX_YOUTUBE_SUBSCRIPTIONS = 5;
const MAX_YOUTUBE_SUBSCRIPTIONS_PREMIUM = 25;

function getSubscriptionLimit(client) {
  return client?.isPremiumInstance ? MAX_YOUTUBE_SUBSCRIPTIONS_PREMIUM : MAX_YOUTUBE_SUBSCRIPTIONS;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Manage YouTube upload notifications')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a YouTube channel notification subscription')
        .addStringOption(o =>
          o.setName('channel')
            .setDescription('YouTube channel ID, @handle, username, or URL')
            .setRequired(true)
        )
        .addChannelOption(o =>
          o.setName('target_channel')
            .setDescription('Discord channel to post notifications')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('ping_role')
            .setDescription('Optional role to ping on upload')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a YouTube channel notification subscription')
        .addStringOption(o =>
          o.setName('channel')
            .setDescription('YouTube channel ID, @handle, username, or URL')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List YouTube notification subscriptions')
    ),

  async execute(interaction) {
    if (!await canManageYouTube(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      try {
        const channelInput = interaction.options.getString('channel').trim();
        const targetChannel = interaction.options.getChannel('target_channel');
        const pingRole = interaction.options.getRole('ping_role');

        if (!targetChannel || targetChannel.guildId !== interaction.guildId) {
          return interaction.reply({
            content: '❌ Please pick a valid channel from this server.',
            flags: MessageFlags.Ephemeral
          });
        }

        const existingRows = await query(
          `SELECT youtube_channel_id FROM youtube_subscriptions WHERE guild_id = ?`,
          [interaction.guildId]
        );

        const maxSubscriptions = getSubscriptionLimit(interaction.client);
        if (existingRows.length >= maxSubscriptions) {
          return interaction.reply({
            content: `❌ You can only configure up to ${maxSubscriptions} YouTube channels per server.`,
            flags: MessageFlags.Ephemeral
          });
        }

        const resolved = await resolveYouTubeChannelId(channelInput);
        if (!resolved) {
          return interaction.reply({
            content: '❌ Could not find that YouTube channel. Try @handle, channel ID (UC...), username, or URL.',
            flags: MessageFlags.Ephemeral
          });
        }

        const alreadyConfigured = existingRows.some(row => row.youtube_channel_id === resolved.channelId);
        if (alreadyConfigured) {
          return interaction.reply({
            content: '❌ That YouTube channel is already configured in this server.',
            flags: MessageFlags.Ephemeral
          });
        }

        const token = youtubeSetupState.create({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          youtubeChannelId: resolved.channelId,
          youtubeDisplay: resolved.display,
          targetChannelId: targetChannel.id,
          pingRoleId: pingRole?.id || null
        });

        const previewEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('Review YouTube Notification Setup')
          .setDescription('Confirm the settings below, or run a test message first.')
          .addFields(
            { name: 'YouTube Channel', value: `${resolved.display} (\`${resolved.channelId}\`)` },
            { name: 'Discord Channel', value: `<#${targetChannel.id}>`, inline: true },
            { name: 'Ping Role', value: pingRole ? `<@&${pingRole.id}>` : 'None', inline: true }
          )
          .setFooter({ text: 'This preview expires in 10 minutes.' });

        const controls = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`youtube_test_${token}`)
            .setLabel('Send Test')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`youtube_confirm_${token}`)
            .setLabel('Confirm & Create')
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({
          embeds: [previewEmbed],
          components: [controls],
          flags: MessageFlags.Ephemeral
        });
      } catch {
        return interaction.reply({ content: '❌ Could not prepare this YouTube setup.', flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'remove') {
      const channelInput = interaction.options.getString('channel').trim();
      const resolved = await resolveYouTubeChannelId(channelInput);

      if (!resolved) {
        return interaction.reply({
          content: '❌ Could not find that YouTube channel. Try @handle, channel ID (UC...), username, or URL.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `DELETE FROM youtube_subscriptions
         WHERE guild_id = ? AND youtube_channel_id = ?`,
        [interaction.guild.id, resolved.channelId]
      );

      return interaction.reply({
        content: `✅ Removed YouTube subscription for **${resolved.display}** (\`${resolved.channelId}\`).`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rows = await query(
      `SELECT youtube_channel_id, discord_channel_id, ping_role_id
       FROM youtube_subscriptions
       WHERE guild_id = ?
       ORDER BY updated_at DESC`,
      [interaction.guild.id]
    );

    if (!rows.length) {
      return interaction.reply({ content: 'No YouTube subscriptions are configured.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle(`📺 YouTube Subscriptions (${rows.length}/${getSubscriptionLimit(interaction.client)})`)
      .setDescription(
        rows.map(row =>
          `• \`${row.youtube_channel_id}\` → <#${row.discord_channel_id}>${row.ping_role_id ? ` (ping <@&${row.ping_role_id}>)` : ''}`
        ).join('\n')
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};

async function canManageYouTube(interaction) {
  return checkPerms(interaction);
}

async function resolveYouTubeChannelId(input) {
  const raw = input.trim();

  if (/^UC[\w-]{10,}$/.test(raw)) {
    const display = await fetchChannelTitleFromFeed(raw);
    return { channelId: raw, display: display || raw };
  }

  const candidates = new Set();

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    candidates.add(raw);
  } else {
    const normalized = raw.replace(/^@/, '');
    candidates.add(`https://www.youtube.com/@${normalized}`);
    candidates.add(`https://www.youtube.com/user/${normalized}`);
    candidates.add(`https://www.youtube.com/c/${normalized}`);
    candidates.add(`https://www.youtube.com/channel/${normalized}`);
  }

  for (const url of candidates) {
    const resolved = await resolveFromUrl(url);
    if (resolved) return resolved;
  }

  return null;
}

async function resolveFromUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; bbgames-bot/1.0)'
      }
    });

    if (!response.ok) return null;

    const html = await response.text();

    const byCanonical = html.match(/"channelId":"(UC[\w-]+)"/);
    const byMeta = html.match(/<meta itemprop="channelId" content="(UC[\w-]+)">/i);
    const byLink = html.match(/\/channel\/(UC[\w-]+)/);
    const channelId = byCanonical?.[1] || byMeta?.[1] || byLink?.[1];

    if (!channelId) return null;

    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"\s*\/?>/i);
    const title = titleMatch?.[1] || (await fetchChannelTitleFromFeed(channelId)) || channelId;

    return { channelId, display: decodeHtml(title) };
  } catch {
    return null;
  }
}

async function fetchChannelTitleFromFeed(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!res.ok) return null;

    const xml = await res.text();
    const title = xml.match(/<title>([^<]+)<\/title>/i)?.[1];
    return title ? decodeHtml(title) : null;
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
