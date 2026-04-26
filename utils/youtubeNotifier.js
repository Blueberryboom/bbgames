const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VIDEO_AGE_MS = 15 * 60 * 1000;
const notifierIntervals = new WeakMap();
const runningChecks = new WeakSet();
const recentlyNotified = new Map();

function stopYouTubeNotifier(client) {
  const existingInterval = notifierIntervals.get(client);
  if (existingInterval) {
    clearInterval(existingInterval);
    notifierIntervals.delete(client);
  }
}

module.exports = {
  initYouTubeNotifier(client) {
    stopYouTubeNotifier(client);

    runCheck(client).catch(err => {
      console.error('<:warning:1496193692099285255> Initial YouTube notifier check failed:', err);
    });

    const interval = setInterval(() => {
      runCheck(client).catch(err => {
        console.error('<:warning:1496193692099285255> YouTube notifier check failed:', err);
      });
    }, CHECK_INTERVAL_MS);

    notifierIntervals.set(client, interval);
    client.once('shardDisconnect', () => stopYouTubeNotifier(client));
    client.once('invalidated', () => stopYouTubeNotifier(client));
    console.log(`<:checkmark:1495875811792781332> YouTube notifier initialized for ${client.user?.tag || 'client'}.`);
  },
  stopYouTubeNotifier
};

async function runCheck(client) {
  if (runningChecks.has(client)) return;
  runningChecks.add(client);

  const now = Date.now();
  pruneRecentlyNotified(now);

  try {
    const subscriptions = await query(
      `SELECT guild_id, discord_channel_id, youtube_channel_id, ping_role_id, last_video_id
       FROM youtube_subscriptions`
    );

    for (const sub of subscriptions) {
      try {
        const guild = client.guilds.cache.get(sub.guild_id);
        if (!guild) continue;

        const latest = await fetchLatestVideo(sub.youtube_channel_id);
        if (!latest) continue;

        if (!sub.last_video_id) {
          await query(
            `UPDATE youtube_subscriptions
             SET last_video_id = ?, last_checked_at = ?
             WHERE guild_id = ? AND youtube_channel_id = ?`,
            [latest.videoId, now, sub.guild_id, sub.youtube_channel_id]
          );
          continue;
        }

        if (sub.last_video_id === latest.videoId) {
          await query(
            `UPDATE youtube_subscriptions
             SET last_checked_at = ?
             WHERE guild_id = ? AND youtube_channel_id = ?`,
            [now, sub.guild_id, sub.youtube_channel_id]
          );
          continue;
        }

        if (!isFreshUpload(latest.publishedAtMs, now)) {
          await query(
            `UPDATE youtube_subscriptions
             SET last_checked_at = ?
             WHERE guild_id = ? AND youtube_channel_id = ?`,
            [now, sub.guild_id, sub.youtube_channel_id]
          );
          continue;
        }

        const dedupeKey = `${sub.guild_id}:${sub.youtube_channel_id}:${latest.videoId}`;
        if (recentlyNotified.has(dedupeKey)) {
          continue;
        }

        const channel = guild.channels.cache.get(sub.discord_channel_id) || await client.channels.fetch(sub.discord_channel_id).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const ping = sub.ping_role_id ? `<@&${sub.ping_role_id}> ` : '';

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle(latest.title)
          .setURL(latest.url)
          .setDescription('Watch now on YouTube.')
          .setImage(`https://i.ytimg.com/vi/${latest.videoId}/maxresdefault.jpg`)
          .setFooter({ text: `YouTube • ${latest.channelName}` });

        await channel.send({
          content: `${ping}**${latest.channelName}** just uploaded a video on **YouTube**! Check it out!`,
          embeds: [embed],
          allowedMentions: sub.ping_role_id ? { parse: [], roles: [sub.ping_role_id] } : { parse: [] }
        });
        recentlyNotified.set(dedupeKey, now);

        await query(
          `UPDATE youtube_subscriptions
           SET last_video_id = ?, last_checked_at = ?
           WHERE guild_id = ? AND youtube_channel_id = ?`,
          [latest.videoId, now, sub.guild_id, sub.youtube_channel_id]
        );

      } catch (err) {
        console.error(`<:warning:1496193692099285255> YouTube notifier failed for ${sub.youtube_channel_id} in guild ${sub.guild_id}:`, err.message || err);
      }
    }
  } finally {
    runningChecks.delete(client);
  }
}

async function fetchLatestVideo(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  if (!res.ok) return null;

  const xml = await res.text();

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) return null;

  const entry = entryMatch[1];
  const videoId = readTag(entry, 'yt:videoId');
  const title = readTag(entry, 'title');
  const publishedAt = readTag(entry, 'published') || readTag(entry, 'updated');
  const url = readAttr(entry, 'link', 'href') || `https://www.youtube.com/watch?v=${videoId}`;
  const channelName = readTag(xml, 'name') || channelId;
  const publishedAtMs = publishedAt ? Date.parse(publishedAt) : NaN;

  if (!videoId || !title) return null;

  return { videoId, title, url, channelName, publishedAtMs };
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : null;
}

function readAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]+)"[^>]*>`, 'i');
  const match = xml.match(regex);
  return match ? decodeXml(match[1].trim()) : null;
}

function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isFreshUpload(publishedAtMs, nowMs) {
  if (!Number.isFinite(publishedAtMs)) return false;
  const ageMs = nowMs - publishedAtMs;
  return ageMs >= 0 && ageMs <= MAX_VIDEO_AGE_MS;
}

function pruneRecentlyNotified(nowMs) {
  for (const [key, notifiedAt] of recentlyNotified.entries()) {
    if (nowMs - notifiedAt > MAX_VIDEO_AGE_MS) {
      recentlyNotified.delete(key);
    }
  }
}
