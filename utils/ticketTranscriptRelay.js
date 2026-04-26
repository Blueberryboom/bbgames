const { query } = require('../database');

function getTranscriptThreadIdFromTopic(topic) {
  if (!topic) return null;
  const match = topic.match(/(?:^|\s|\|)transcript_thread_id:([0-9]{5,30})(?:\s|\||$)/);
  return match ? match[1] : null;
}

async function relayTicketMessageToTranscript(message) {
  if (!message?.guildId || !message.channel?.isTextBased()) return;
  if (message.author?.bot) return;

  const ticketRows = await query(
    'SELECT id, display_id FROM tickets WHERE guild_id = ? AND channel_id = ? LIMIT 1',
    [message.guildId, message.channel.id]
  );
  if (!ticketRows.length) return;

  let threadId = getTranscriptThreadIdFromTopic(message.channel.topic);
  if (!threadId) {
    const settingsRows = await query(
      'SELECT transcripts_channel_id FROM ticket_settings WHERE guild_id = ? LIMIT 1',
      [message.guildId]
    );
    const transcriptsChannelId = settingsRows[0]?.transcripts_channel_id;
    if (!transcriptsChannelId) return;

    const transcriptsChannel = await message.guild.channels.fetch(transcriptsChannelId).catch(() => null);
    if (!transcriptsChannel?.isTextBased()) return;

    const thread = await transcriptsChannel.threads.create({
      name: `ticket-${ticketRows[0].display_id}-${message.channel.name}`.slice(0, 100),
      autoArchiveDuration: 10080,
      reason: `Transcript thread for ticket #${ticketRows[0].display_id}`
    }).catch(() => null);
    if (!thread?.id) return;

    threadId = thread.id;
    const topicParts = (message.channel.topic || '')
      .split(' | ')
      .filter(Boolean)
      .filter(part => !part.startsWith('transcript_thread_id:'));
    topicParts.push(`transcript_thread_id:${threadId}`);
    await message.channel.setTopic(topicParts.join(' | ').slice(0, 1024)).catch(() => null);
  }

  const transcriptThread = await message.guild.channels.fetch(threadId).catch(() => null);
  if (!transcriptThread?.isTextBased()) return;

  const content = message.content?.trim();
  const attachmentUrls = [...message.attachments.values()].map(file => file.url).join(' ');
  const cleanedMessage = [content, attachmentUrls].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || '[no text]';
  const line = `<t:${Math.floor(message.createdTimestamp / 1000)}:F> | **${message.author.username}** : ${cleanedMessage}`.slice(0, 1900);
  await transcriptThread.send({ content: line }).catch(() => null);
}

module.exports = {
  relayTicketMessageToTranscript
};
