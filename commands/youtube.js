const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

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
            .setDescription('Discord channel to post notifications (recommended)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('target_channel_text')
            .setDescription('Discord channel mention, ID, or exact name')
            .setRequired(false)
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
    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const channelInput = interaction.options.getString('channel').trim();
      const targetChannelOption = interaction.options.getChannel('target_channel');
      const targetChannelText = interaction.options.getString('target_channel_text');
      const pingRole = interaction.options.getRole('ping_role');

      const targetChannel = targetChannelOption || resolveGuildTextChannel(interaction.guild, targetChannelText);
      if (!targetChannel) {
        return interaction.reply({
          content: '❌ Please provide a valid Discord text channel using selector, mention, ID, or exact name.',
          flags: MessageFlags.Ephemeral
        });
      }

      const resolved = await resolveYouTubeChannelId(channelInput);
      if (!resolved) {
        return interaction.reply({
          content: '❌ Could not resolve that YouTube channel. Try channel ID (`UC...`), @handle, username, or full URL.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `REPLACE INTO youtube_subscriptions
         (guild_id, youtube_channel_id, discord_channel_id, ping_role_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [interaction.guild.id, resolved.channelId, targetChannel.id, pingRole?.id || null, Date.now()]
      );

      return interaction.reply({
        content: `✅ YouTube notifications configured for **${resolved.display}** (\`${resolved.channelId}\`) in ${targetChannel}${pingRole ? ` (ping ${pingRole})` : ''}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'remove') {
      const channelInput = interaction.options.getString('channel').trim();
      const resolved = await resolveYouTubeChannelId(channelInput);

      if (!resolved) {
        return interaction.reply({
          content: '❌ Could not resolve that YouTube channel. Try channel ID (`UC...`), @handle, username, or full URL.',
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
      .setTitle('📺 YouTube Subscriptions')
      .setDescription(
        rows.map(row =>
          `• \`${row.youtube_channel_id}\` → <#${row.discord_channel_id}>${row.ping_role_id ? ` (ping <@&${row.ping_role_id}>)` : ''}`
        ).join('\n')
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};

function resolveGuildTextChannel(guild, input) {
  if (!input) return null;

  const trimmed = input.trim();
  const mention = trimmed.match(/^<#(\d+)>$/);
  const id = mention ? mention[1] : (/^\d+$/.test(trimmed) ? trimmed : null);

  if (id) {
    const byId = guild.channels.cache.get(id);
    return byId?.type === ChannelType.GuildText ? byId : null;
  }

  const normalized = trimmed.toLowerCase().replace(/^#/, '');
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && channel.name.toLowerCase() === normalized
  ) || null;
}

async function resolveYouTubeChannelId(input) {
  const raw = input.trim();

  if (/^UC[\w-]{10,}$/.test(raw)) {
    return { channelId: raw, display: raw };
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
    const title = titleMatch?.[1] || channelId;

    return { channelId, display: decodeHtml(title) };
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
