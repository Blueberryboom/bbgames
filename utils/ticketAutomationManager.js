const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { query } = require('../database');
const { getGuildTicketSettings } = require('./ticketSystem');

const PROCESS_INTERVAL_MS = 15_000;
let processTimer = null;
let isProcessing = false;

async function trackTicketMessageActivity(message) {
  if (!message?.guildId || !message.channelId || message.author?.bot) return;
  await query(
    `UPDATE tickets
     SET last_activity_at = ?
     WHERE guild_id = ? AND channel_id = ?`,
    [Date.now(), message.guildId, message.channelId]
  ).catch(() => null);
}

async function closeTicketByAutomation(client, ticket, reason) {
  await query('DELETE FROM ticket_automation_close_requests WHERE guild_id = ? AND ticket_id = ?', [ticket.guild_id, ticket.id]).catch(() => null);

  const guild = client.guilds.cache.get(ticket.guild_id) || await client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) {
    await query('DELETE FROM tickets WHERE id = ?', [ticket.id]).catch(() => null);
    return;
  }

  const settings = await getGuildTicketSettings(ticket.guild_id);
  if (settings?.transcripts_channel_id) {
    const transcriptChannel = await guild.channels.fetch(settings.transcripts_channel_id).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      const closeEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('Ticket Closed (Automation)')
        .setDescription(`Ticket #${ticket.display_id} has been closed.`)
        .addFields(
          { name: 'Type', value: ticket.type_name || 'Unknown', inline: true },
          { name: 'Owner', value: `<@${ticket.user_id}>`, inline: true },
          { name: 'Reason', value: reason.slice(0, 1000), inline: false }
        )
        .setTimestamp(new Date());

      await transcriptChannel.send({ embeds: [closeEmbed], allowedMentions: { parse: [] } }).catch(() => null);
    }
  }

  await query('DELETE FROM tickets WHERE id = ?', [ticket.id]).catch(() => null);

  const channel = guild.channels.cache.get(ticket.channel_id) || await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (channel) {
    await channel.delete(reason.slice(0, 512)).catch(() => null);
  }
}

async function runAutomationAction(client, automation, ticket) {
  const guild = client.guilds.cache.get(ticket.guild_id) || await client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) return;

  const channel = guild.channels.cache.get(ticket.channel_id) || await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  if (automation.action_type === 'send_message') {
    await channel.send({ content: automation.action_message || 'Automation message.', allowedMentions: { parse: [] } }).catch(() => null);
    return;
  }

  if (automation.action_type === 'send_close_request') {
    const pendingRows = await query(
      `SELECT id
       FROM ticket_automation_close_requests
       WHERE guild_id = ? AND ticket_id = ? AND resolved = 0
       LIMIT 1`,
      [ticket.guild_id, ticket.id]
    );
    if (pendingRows.length) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_close_request_yes:${ticket.id}`)
        .setLabel('<:checkmark:1495875811792781332> Yes, close this ticket')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${ticket.user_id}>, automation **${automation.name}** requested to close this ticket.`,
      components: [row],
      allowedMentions: { users: [ticket.user_id] }
    }).catch(() => null);

    await query(
      `INSERT INTO ticket_automation_close_requests
       (guild_id, ticket_id, channel_id, automation_name, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticket.guild_id, ticket.id, ticket.channel_id, automation.name, Date.now() + (24 * 60 * 60 * 1000), Date.now()]
    ).catch(() => null);
    return;
  }

  if (automation.action_type === 'close') {
    await closeTicketByAutomation(
      client,
      ticket,
      `Automation (${automation.name}) closed the ticket`
    );
    return;
  }

  if (automation.action_type === 'send_alert') {
    const settings = await getGuildTicketSettings(ticket.guild_id);
    if (!settings?.transcripts_channel_id) return;
    const logChannel = await guild.channels.fetch(settings.transcripts_channel_id).catch(() => null);
    if (!logChannel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('Ticket Automation Alert')
      .setDescription(`Automation **${automation.name}** was triggered.`)
      .addFields(
        { name: 'Ticket', value: `<#${ticket.channel_id}>`, inline: true },
        { name: 'Owner', value: `<@${ticket.user_id}>`, inline: true },
        { name: 'Type', value: ticket.type_name || 'Unknown', inline: true }
      )
      .setTimestamp(new Date());

    await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  }
}

async function processTicketAutomations(client) {
  const now = Date.now();
  const automationRows = await query(
    `SELECT id, guild_id, name, ticket_type_id, trigger_mode, duration_ms, action_type, action_message, disabled_until
     FROM ticket_automations
     WHERE (disabled_until IS NULL OR disabled_until <= ?)
       AND guild_id NOT IN (SELECT guild_id FROM guild_deletion_queue)`,
    [now]
  );

  for (const automation of automationRows) {
    const tickets = await query(
      `SELECT t.id, t.guild_id, t.channel_id, t.user_id, t.display_id, t.created_at, t.last_activity_at, tt.name AS type_name
       FROM tickets t
       INNER JOIN ticket_types tt ON tt.guild_id = t.guild_id AND tt.id = t.type_id
       WHERE t.guild_id = ? AND t.type_id = ?`,
      [automation.guild_id, automation.ticket_type_id]
    );

    for (const ticket of tickets) {
      const anchor = automation.trigger_mode === 'time_without_message'
        ? Number(ticket.last_activity_at || ticket.created_at || now)
        : Number(ticket.created_at || now);

      if (anchor + Number(automation.duration_ms || 0) > now) {
        continue;
      }

      const marker = `ticket_automation_marker:${automation.id}:${ticket.id}`;
      const markerRows = await query(
        `SELECT id
         FROM ticket_automation_close_requests
         WHERE guild_id = ? AND ticket_id = ? AND automation_name = ?
         LIMIT 1`,
        [ticket.guild_id, ticket.id, marker]
      );
      if (markerRows.length) {
        continue;
      }

      await runAutomationAction(client, automation, ticket);

      if (automation.action_type !== 'send_close_request') {
        await query(
          `INSERT INTO ticket_automation_close_requests
           (guild_id, ticket_id, channel_id, automation_name, expires_at, resolved, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [ticket.guild_id, ticket.id, ticket.channel_id, marker, now + (365 * 24 * 60 * 60 * 1000), now]
        ).catch(() => null);
      }
    }
  }

  const pendingRequests = await query(
    `SELECT id, guild_id, ticket_id, automation_name
     FROM ticket_automation_close_requests
     WHERE resolved = 0 AND expires_at <= ?`,
    [now]
  );

  for (const pending of pendingRequests) {
    const rows = await query(
      `SELECT t.id, t.guild_id, t.channel_id, t.user_id, t.display_id, t.created_at, t.last_activity_at, tt.name AS type_name
       FROM tickets t
       INNER JOIN ticket_types tt ON tt.guild_id = t.guild_id AND tt.id = t.type_id
       WHERE t.id = ? AND t.guild_id = ? LIMIT 1`,
      [pending.ticket_id, pending.guild_id]
    );

    const ticket = rows[0];
    if (!ticket) {
      await query('UPDATE ticket_automation_close_requests SET resolved = 1 WHERE id = ?', [pending.id]).catch(() => null);
      continue;
    }

    await closeTicketByAutomation(
      client,
      ticket,
      `Automation (${pending.automation_name}) send a close request that didn't get a response for 24 hours after it was sent.`
    );

    await query('UPDATE ticket_automation_close_requests SET resolved = 1 WHERE id = ?', [pending.id]).catch(() => null);
  }
}

async function processTicketAutomationsSafely(client) {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await processTicketAutomations(client);
  } finally {
    isProcessing = false;
  }
}

function initTicketAutomationManager(client) {
  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }

  processTimer = setInterval(() => {
    processTicketAutomationsSafely(client).catch(error => {
      console.error('<:warning:1496193692099285255> Ticket automation processor error:', error);
    });
  }, PROCESS_INTERVAL_MS);
  processTimer.unref?.();

  processTicketAutomationsSafely(client).catch(error => {
    console.error('<:warning:1496193692099285255> Ticket automation startup run failed:', error);
  });
}

module.exports = {
  initTicketAutomationManager,
  processTicketAutomations,
  trackTicketMessageActivity
};
