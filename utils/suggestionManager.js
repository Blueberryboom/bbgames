const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');
const { statusLabel } = require('./suggestionSystem');

const STALE_AFTER_MS = 28 * 24 * 60 * 60 * 1000;
const AUTO_CLOSE_AFTER_STALE_MS = 14 * 24 * 60 * 60 * 1000;
let staleInterval = null;

function staleStatusText(status) {
  return `${statusLabel(status)} • Stale`;
}

async function lockSuggestionThread(client, guildId, threadId) {
  if (!threadId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const thread = await guild?.channels.fetch(threadId).catch(() => null);
  if (thread && typeof thread.setLocked === 'function') {
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }
}

async function closeSuggestion(client, suggestion, reasonText = 'Closed') {
  const guild = await client.guilds.fetch(suggestion.guild_id).catch(() => null);
  const channel = await guild?.channels.fetch(suggestion.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(suggestion.message_id).catch(() => null);
  if (message?.embeds?.length) {
    const embed = EmbedBuilder.from(message.embeds[0]).setColor(0xED4245);
    const fields = (embed.data.fields || []).map(field =>
      field.name.toLowerCase() === 'status'
        ? { ...field, value: reasonText }
        : field
    );
    embed.setFields(fields);
    await message.edit({ embeds: [embed], components: [] }).catch(() => null);
  }
  await lockSuggestionThread(client, suggestion.guild_id, suggestion.thread_id);
  await query('DELETE FROM suggestions WHERE id = ?', [suggestion.id]);
}

async function processSuggestionAging(client) {
  const now = Date.now();
  const rows = await query(
    `SELECT id, guild_id, channel_id, message_id, thread_id, title, status, updated_at, stale_marked_at
     FROM suggestions
     WHERE stale_exempt = 0`
  );

  for (const suggestion of rows) {
    const updatedAt = Number(suggestion.updated_at || suggestion.created_at || 0);
    const staleMarkedAt = suggestion.stale_marked_at ? Number(suggestion.stale_marked_at) : null;

    if (!staleMarkedAt && now - updatedAt >= STALE_AFTER_MS) {
      const guild = await client.guilds.fetch(suggestion.guild_id).catch(() => null);
      const channel = await guild?.channels.fetch(suggestion.channel_id).catch(() => null);
      const message = await channel?.messages.fetch(suggestion.message_id).catch(() => null);
      if (!message?.embeds?.length) {
        await query('DELETE FROM suggestions WHERE id = ?', [suggestion.id]);
        continue;
      }

      const embed = EmbedBuilder.from(message.embeds[0]).setColor(0x5DADE2);
      const fields = (embed.data.fields || []).map(field =>
        field.name.toLowerCase() === 'status'
          ? { ...field, value: staleStatusText(suggestion.status) }
          : field
      );
      embed.setFields(fields);

      const staleButton = {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: 'suggestion_remove_stale', label: 'Remove Stale Status' }
        ]
      };

      await message.edit({ embeds: [embed], components: [...message.components.map(c => c.toJSON()), staleButton] }).catch(() => null);
      await channel.send({
        content: `\"${suggestion.title}\" has been marked as stale, as it's status has not been updated for 28 days. If there is no activity in the next 14 days it will be automatically closed. [Jump to suggestion](${message.url})`
      }).catch(() => null);

      await query('UPDATE suggestions SET stale_marked_at = ? WHERE id = ?', [now, suggestion.id]);
      continue;
    }

    if (staleMarkedAt && now - staleMarkedAt >= AUTO_CLOSE_AFTER_STALE_MS) {
      await closeSuggestion(client, suggestion, 'Denied');
    }
  }
}

function initSuggestionManager(client) {
  const shardId = client.shard?.ids?.[0] ?? 0;
  if (client.shard && shardId !== 0) return;
  if (staleInterval) clearInterval(staleInterval);
  processSuggestionAging(client).catch(() => null);
  staleInterval = setInterval(() => {
    processSuggestionAging(client).catch(() => null);
  }, 60 * 60 * 1000);
  staleInterval.unref?.();
}

module.exports = {
  initSuggestionManager,
  processSuggestionAging,
  closeSuggestion
};
