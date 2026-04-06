const { EmbedBuilder } = require('discord.js');
const { query } = require('../database');

const CLAIM_NOTICE_DELETE_MS = 10_000;

async function maybeSendTicketClaimNotice(message) {
  if (!message?.guildId || !message.channel?.isTextBased()) return;
  if (message.author?.bot) return;

  const rows = await query(
    'SELECT user_id, claimed_by FROM tickets WHERE guild_id = ? AND channel_id = ? LIMIT 1',
    [message.guildId, message.channel.id]
  );
  const ticket = rows[0];
  if (!ticket?.claimed_by) return;

  const isOwner = message.author.id === ticket.user_id;
  const isClaimer = message.author.id === ticket.claimed_by;
  if (isOwner || isClaimer) return;

  const noticeEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Ticket has already been claimed')
    .setDescription(`Ticket claimed by <@${ticket.claimed_by}>`);

  const noticeMessage = await message.channel.send({
    embeds: [noticeEmbed],
    allowedMentions: { parse: [], users: [ticket.claimed_by] }
  }).catch(() => null);

  if (noticeMessage) {
    setTimeout(() => {
      noticeMessage.delete().catch(() => null);
    }, CLAIM_NOTICE_DELETE_MS);
  }
}

module.exports = {
  maybeSendTicketClaimNotice
};
