const { ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { pool, query } = require('../database');
const checkPerms = require('./checkEventPerms');

const WORKLOAD_LABELS = {
  low: 'Low Workload',
  medium: 'Medium Workload',
  high: 'High Workload'
};

const WORKLOAD_EMOJIS = {
  low: '🟢',
  medium: '🟡',
  high: '🔴'
};

function parseRoleIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map(value => String(value).trim())
      .filter(value => /^\d{5,}$/.test(value));
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (/^\d{5,}(,\s*\d{5,})*$/.test(trimmed)) {
      return trimmed.split(',').map(value => value.trim()).filter(Boolean);
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(value => String(value).trim())
        .filter(value => /^\d{5,}$/.test(value));
    }
    if (typeof parsed === 'string' && /^\d{5,}$/.test(parsed.trim())) {
      return [parsed.trim()];
    }
    return [];
  } catch {
    return [];
  }
}

function parseCooldown(input) {
  if (!input) return 0;
  const value = input.trim().toLowerCase();
  const matches = [...value.matchAll(/(\d+)\s*([dhm])/g)];
  if (!matches.length) return null;

  let ms = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (unit === 'd') ms += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') ms += amount * 60 * 60 * 1000;
    if (unit === 'm') ms += amount * 60 * 1000;
  }

  const stripped = value.replace(/(\d+)\s*[dhm]/g, '').trim();
  if (stripped.length) return null;

  return ms;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.ceil((ms % (60 * 60 * 1000)) / (60 * 1000));
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function workloadLevel(count) {
  if (count >= 5) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

async function getGuildTicketSettings(guildId) {
  const rows = await query('SELECT * FROM ticket_settings WHERE guild_id = ? LIMIT 1', [guildId]);
  return rows[0] || null;
}

async function getTicketTypeById(guildId, typeId) {
  const rows = await query('SELECT * FROM ticket_types WHERE guild_id = ? AND id = ? LIMIT 1', [guildId, typeId]);
  return rows[0] || null;
}

async function isStaffForTicket(interaction, ticketType) {
  if (!interaction.inGuild()) return false;
  if (await checkPerms(interaction)) return true;
  const staffRoles = parseRoleIds(ticketType?.staff_role_ids);
  if (!staffRoles.length) return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || false;
  return staffRoles.some(roleId => interaction.member.roles.cache.has(roleId));
}

function buildTicketControls(ticketId) {
  return {
    claim: `ticket_claim:${ticketId}`,
    close: `ticket_close:${ticketId}`,
    closeReason: `ticket_close_reason:${ticketId}`,
    closeRequestYes: `ticket_close_request_yes:${ticketId}`
  };
}

async function buildWorkloadEmbed(guildId, useEmojis = true) {
  const types = await query('SELECT id, name FROM ticket_types WHERE guild_id = ? ORDER BY name ASC', [guildId]);
  if (!types.length) return null;

  const openCounts = await query(
    `SELECT type_id, COUNT(*) AS total
     FROM tickets
     WHERE guild_id = ?
     GROUP BY type_id`,
    [guildId]
  );

  const countMap = new Map(openCounts.map(row => [Number(row.type_id), Number(row.total)]));

  const lines = types.map(type => {
    const total = countMap.get(Number(type.id)) || 0;
    const level = workloadLevel(total);
    const emoji = useEmojis ? `${WORKLOAD_EMOJIS[level]} ` : '';
    return `• **${type.name}** | ${emoji}${WORKLOAD_LABELS[level]} (${total})`;
  });

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Ticket Workload')
    .setDescription(lines.join('\n'));
}

async function refreshWorkloadPanel(guild) {
  if (!guild?.id) return false;

  const settings = await getGuildTicketSettings(guild.id);
  if (!settings?.workload_channel_id || !settings?.workload_message_id) {
    return false;
  }

  const channel = await guild.channels.fetch(settings.workload_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const message = await channel.messages.fetch(settings.workload_message_id).catch(() => null);
  if (!message) return false;

  const embed = await buildWorkloadEmbed(guild.id, true);
  if (!embed) return false;

  await message.edit({ embeds: [embed] }).catch(() => null);
  return true;
}

async function ensureTicketCategory(guild, categoryId) {
  if (!categoryId) return null;
  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return null;
  return category;
}

async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ ...payload, flags: payload.flags || MessageFlags.Ephemeral });
  }
  return interaction.reply(payload);
}

async function allocateGuildTicketDisplayId(guildId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO ticket_settings (guild_id, next_ticket_display_id, updated_at)
       VALUES (?, 2, UNIX_TIMESTAMP() * 1000)
       ON DUPLICATE KEY UPDATE next_ticket_display_id = next_ticket_display_id + 1`,
      [guildId]
    );
    const rows = await conn.query(
      `SELECT next_ticket_display_id - 1 AS display_id
       FROM ticket_settings
       WHERE guild_id = ?
       LIMIT 1`,
      [guildId]
    );
    await conn.commit();
    return Number(rows[0]?.display_id || 1);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  WORKLOAD_EMOJIS,
  WORKLOAD_LABELS,
  parseRoleIds,
  parseCooldown,
  formatDuration,
  workloadLevel,
  getGuildTicketSettings,
  getTicketTypeById,
  isStaffForTicket,
  buildTicketControls,
  buildWorkloadEmbed,
  refreshWorkloadPanel,
  ensureTicketCategory,
  safeReply,
  allocateGuildTicketDisplayId
};
