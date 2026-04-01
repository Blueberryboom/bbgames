const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { BOT_OWNER_ID } = require('../utils/constants');

const REGISTER_COOLDOWN_MONTHS = 4;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Configure and register birthdays for this server')
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Enable birthdays and overwrite birthday config for this server')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where birthday messages are posted')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addRoleOption(option => option.setName('allowed_role_1').setDescription('Role allowed to use /birthday register').setRequired(false))
        .addRoleOption(option => option.setName('allowed_role_2').setDescription('Role allowed to use /birthday register').setRequired(false))
        .addRoleOption(option => option.setName('allowed_role_3').setDescription('Role allowed to use /birthday register').setRequired(false))
        .addRoleOption(option => option.setName('allowed_role_4').setDescription('Role allowed to use /birthday register').setRequired(false))
        .addRoleOption(option => option.setName('allowed_role_5').setDescription('Role allowed to use /birthday register').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('register')
        .setDescription('Register your birthday in DD/MM format')
        .addStringOption(option =>
          option
            .setName('date')
            .setDescription('Birthday in DD/MM format, e.g. 05/11')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable birthday module for this server')
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === 'config') return handleConfig(interaction);
      if (sub === 'disable') return handleDisable(interaction);
      return handleRegister(interaction);
    } catch (error) {
      console.error('❌ Birthday command error:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '❌ Birthday action failed. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.followUp({
        content: '❌ Birthday action failed. Please try again.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

async function handleConfig(interaction) {
  if (!await checkPerms(interaction)) {
    return interaction.reply({
      content: '❌ You need administrator, manager role, or owner access for this command.',
      flags: MessageFlags.Ephemeral
    });
  }

  const channel = interaction.options.getChannel('channel', true);
  const roleIds = [];

  for (let i = 1; i <= 5; i += 1) {
    const role = interaction.options.getRole(`allowed_role_${i}`);
    if (role && !roleIds.includes(role.id)) {
      roleIds.push(role.id);
    }
  }

  await query(
    `REPLACE INTO birthday_settings (guild_id, enabled, channel_id, allowed_role_ids, updated_by, updated_at)
     VALUES (?, 1, ?, ?, ?, ?)`,
    [
      interaction.guildId,
      channel.id,
      roleIds.join(','),
      interaction.user.id,
      Date.now()
    ]
  );

  const allowedRolesText = roleIds.length
    ? roleIds.map(roleId => `<@&${roleId}>`).join(', ')
    : 'Everyone';

  return interaction.reply({
    content: `✅ Birthday module configured in <#${channel.id}>. Allowed roles for registration: ${allowedRolesText}.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleDisable(interaction) {
  if (!await checkPerms(interaction)) {
    return interaction.reply({
      content: '❌ You need administrator, manager role, or owner access for this command.',
      flags: MessageFlags.Ephemeral
    });
  }

  await query('DELETE FROM birthday_settings WHERE guild_id = ?', [interaction.guildId]);

  return interaction.reply({
    content: '✅ Birthday module disabled for this server.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleRegister(interaction) {
  const input = interaction.options.getString('date', true).trim();
  const parsed = parseBirthday(input);

  if (!parsed) {
    return interaction.reply({
      content: '❌ Invalid date format. Use DD/MM (example: 05/11).',
      flags: MessageFlags.Ephemeral
    });
  }

  const configRows = await query(
    `SELECT enabled, allowed_role_ids
     FROM birthday_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [interaction.guildId]
  );

  if (!configRows.length || !configRows[0].enabled) {
    return interaction.reply({
      content: '❌ Birthday module is not enabled in this server. Ask an admin to run `/birthday config` first.',
      flags: MessageFlags.Ephemeral
    });
  }

  const settings = configRows[0];
  const allowedRoleIds = String(settings.allowed_role_ids || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const isAdmin = interaction.member.permissions.has('Administrator');
  const isOwner = interaction.user.id === BOT_OWNER_ID;
  const hasAllowedRole = allowedRoleIds.length === 0
    || allowedRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));

  if (!isAdmin && !isOwner && !hasAllowedRole) {
    return interaction.reply({
      content: '❌ You do not have access to register birthdays in this server.',
      flags: MessageFlags.Ephemeral
    });
  }

  const existingRows = await query(
    `SELECT day, month, last_changed_at
     FROM birthday_users
     WHERE guild_id = ? AND user_id = ?
     LIMIT 1`,
    [interaction.guildId, interaction.user.id]
  );

  if (existingRows.length) {
    const nextAllowedAt = getNextAllowedUpdateTimestamp(existingRows[0].last_changed_at);
    if (Date.now() < nextAllowedAt) {
      const discordTimestamp = `<t:${Math.floor(nextAllowedAt / 1000)}:R>`;
      return interaction.reply({
        content: `❌ You can only change your birthday every ${REGISTER_COOLDOWN_MONTHS} months. You can update it again ${discordTimestamp}.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  await query(
    `REPLACE INTO birthday_users
     (guild_id, user_id, day, month, last_changed_at, last_announced_year, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [
      interaction.guildId,
      interaction.user.id,
      parsed.day,
      parsed.month,
      Date.now(),
      Date.now()
    ]
  );

  return interaction.reply({
    content: `✅ Birthday saved as **${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}**.`,
    flags: MessageFlags.Ephemeral
  });
}

function parseBirthday(input) {
  const match = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;

  const maxDayByMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = maxDayByMonth[month - 1];

  if (day < 1 || day > maxDay) return null;

  return { day, month };
}

function getNextAllowedUpdateTimestamp(lastChangedAt) {
  const base = Number(lastChangedAt || 0);
  const date = new Date(base);
  date.setMonth(date.getMonth() + REGISTER_COOLDOWN_MONTHS);
  return date.getTime();
}
