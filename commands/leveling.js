const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const checkPerms = require('../utils/checkEventPerms');
const { query } = require('../database');
const {
  DEFAULT_WITH_ROLE,
  DEFAULT_WITHOUT_ROLE,
  clampMessage,
  getGuildLevelingSettings,
  invalidateGuildLevelingCache
} = require('../utils/levelingSystem');
const { getPremiumLimit } = require('../utils/premiumPerks');
const { BOT_OWNER_ID } = require('../utils/constants');

const FREE_ROLE_LIMIT = 15;
const PREMIUM_ROLE_LIMIT = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Configure the leveling system')
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure leveling settings (overwrites previous config)')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel for level up messages')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName('difficulty')
            .setDescription('Difficulty from 1 to 5')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('message_with_role')
            .setDescription('Short levelup message when a role is awarded')
            .setMaxLength(160)
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('message_without_role')
            .setDescription('Short levelup message when no role is awarded')
            .setMaxLength(160)
            .setRequired(false)
        )
        .addRoleOption(o => o.setName('boost_role_1').setDescription('Boost role 1').setRequired(false))
        .addRoleOption(o => o.setName('boost_role_2').setDescription('Boost role 2').setRequired(false))
        .addRoleOption(o => o.setName('boost_role_3').setDescription('Boost role 3').setRequired(false))
        .addRoleOption(o => o.setName('boost_role_4').setDescription('Boost role 4').setRequired(false))
        .addRoleOption(o => o.setName('boost_role_5').setDescription('Boost role 5').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('channels')
        .setDescription('Set a whitelist or blacklist of channels (overwrites previous config)')
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Choose whitelist or blacklist')
            .setRequired(false)
            .addChoices(
              { name: 'whitelist', value: 'whitelist' },
              { name: 'blacklist', value: 'blacklist' }
            )
        )
        .addChannelOption(o => o.setName('channel_1').setDescription('Channel 1').setRequired(false))
        .addChannelOption(o => o.setName('channel_2').setDescription('Channel 2').setRequired(false))
        .addChannelOption(o => o.setName('channel_3').setDescription('Channel 3').setRequired(false))
        .addChannelOption(o => o.setName('channel_4').setDescription('Channel 4').setRequired(false))
        .addChannelOption(o => o.setName('channel_5').setDescription('Channel 5').setRequired(false))
        .addChannelOption(o => o.setName('channel_6').setDescription('Channel 6').setRequired(false))
        .addChannelOption(o => o.setName('channel_7').setDescription('Channel 7').setRequired(false))
        .addChannelOption(o => o.setName('channel_8').setDescription('Channel 8').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('roles')
        .setDescription('Configure reward role for a specific level')
        .addIntegerOption(o =>
          o.setName('level')
            .setDescription('Level requirement for this role')
            .setMinValue(1)
            .setMaxValue(1000)
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role to award at this level')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('roles_list')
        .setDescription('List all configured reward roles')
    )
    .addSubcommand(sub =>
      sub
        .setName('level_set')
        .setDescription('Set, add, or remove levels for a member')
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Member to update')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('How to update levels')
            .setRequired(true)
            .addChoices(
              { name: 'set', value: 'set' },
              { name: 'add', value: 'add' },
              { name: 'remove', value: 'remove' }
            )
        )
        .addIntegerOption(o =>
          o.setName('levels')
            .setDescription('Level amount')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('deactivate')
        .setDescription('Disable leveling and remove all leveling data for this server')
    ),

  async execute(interaction) {
    try {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator, manager role, or owner access for this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'config') {
        return handleConfig(interaction);
      }

      if (sub === 'channels') {
        return handleChannels(interaction);
      }

      if (sub === 'roles') {
        return handleRoles(interaction);
      }

      if (sub === 'level_set') {
        return handleLevelSet(interaction);
      }

      if (sub === 'deactivate') {
        return handleDeactivate(interaction);
      }

      return handleRolesList(interaction);
    } catch (error) {
      console.error('❌ Leveling command error:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '❌ Leveling action failed. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.followUp({
        content: '❌ Leveling action failed. Please try again.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

async function handleConfig(interaction) {
  const channel = interaction.options.getChannel('channel');
  const difficulty = interaction.options.getInteger('difficulty');
  const withRole = interaction.options.getString('message_with_role');
  const withoutRole = interaction.options.getString('message_without_role');
  const boostRoleIds = [];

  for (let i = 1; i <= 5; i += 1) {
    const role = interaction.options.getRole(`boost_role_${i}`);
    if (role && !boostRoleIds.includes(role.id)) boostRoleIds.push(role.id);
  }

  const changed = Boolean(channel || difficulty || withRole || withoutRole || boostRoleIds.length);
  if (!changed) {
    const settings = await getGuildLevelingSettings(interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(0x4F8BFF)
      .setTitle('Current Leveling Config')
      .setDescription('No values were provided, so this is the current setup.')
      .addFields(
        { name: 'Levelup Channel', value: settings.levelup_channel_id ? `<#${settings.levelup_channel_id}>` : 'Not set', inline: true },
        { name: 'Difficulty', value: String(settings.difficulty || 3), inline: true },
        { name: 'Boost Roles', value: settings.boostRoleIds.length ? settings.boostRoleIds.map(id => `<@&${id}>`).join(', ') : 'None' },
        { name: 'Message (role)', value: settings.message_with_role },
        { name: 'Message (no role)', value: settings.message_without_role }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const finalDifficulty = difficulty || 3;
  const finalWithRole = clampMessage(withRole, DEFAULT_WITH_ROLE);
  const finalWithoutRole = clampMessage(withoutRole, DEFAULT_WITHOUT_ROLE);

  await query(
    `REPLACE INTO leveling_settings
     (guild_id, enabled, levelup_channel_id, difficulty, boost_role_ids, channel_mode, channel_ids,
      message_with_role, message_without_role, updated_by, updated_at)
     VALUES (?, 1, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      interaction.guildId,
      channel?.id || null,
      finalDifficulty,
      boostRoleIds.join(','),
      finalWithRole,
      finalWithoutRole,
      interaction.user.id,
      Date.now()
    ]
  );
  invalidateGuildLevelingCache(interaction.guildId);

  return interaction.reply({
    content: `✅ Leveling config saved. Difficulty ${finalDifficulty}, channel ${channel ? `<#${channel.id}>` : 'not set'}.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleChannels(interaction) {
  const mode = interaction.options.getString('mode');
  const channelIds = [];
  for (let i = 1; i <= 8; i += 1) {
    const channel = interaction.options.getChannel(`channel_${i}`);
    if (channel && !channelIds.includes(channel.id)) channelIds.push(channel.id);
  }

  if (!mode && !channelIds.length) {
    const settings = await getGuildLevelingSettings(interaction.guildId);
    const modeText = settings.channelMode || 'none';
    const channelsText = settings.channelIds.length ? settings.channelIds.map(id => `<#${id}>`).join(', ') : 'None';

    return interaction.reply({
      content: `Current channel filter: ${modeText}\nChannels: ${channelsText}`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (!mode) {
    return interaction.reply({
      content: '❌ Please choose a mode (whitelist or blacklist) when providing channels.',
      flags: MessageFlags.Ephemeral
    });
  }

  await query(
    `INSERT INTO leveling_settings
     (guild_id, enabled, levelup_channel_id, difficulty, boost_role_ids, channel_mode, channel_ids,
      message_with_role, message_without_role, updated_by, updated_at)
     VALUES (?, 0, NULL, 3, '', ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      channel_mode = VALUES(channel_mode),
      channel_ids = VALUES(channel_ids),
      updated_by = VALUES(updated_by),
      updated_at = VALUES(updated_at)`,
    [
      interaction.guildId,
      mode,
      channelIds.join(','),
      DEFAULT_WITH_ROLE,
      DEFAULT_WITHOUT_ROLE,
      interaction.user.id,
      Date.now()
    ]
  );
  invalidateGuildLevelingCache(interaction.guildId);

  return interaction.reply({
    content: `✅ Channel ${mode} saved with ${channelIds.length} channel(s).`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleDeactivate(interaction) {
  const isOwner = interaction.user.id === BOT_OWNER_ID;
  const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  // This subcommand is intentionally stricter than other /leveling actions.
  if (!isOwner && !isAdministrator) {
    return interaction.reply({
      content: '❌ Only a server administrator can use `/leveling deactivate`.',
      flags: MessageFlags.Ephemeral
    });
  }

  await query(`DELETE FROM leveling_users WHERE guild_id = ?`, [interaction.guildId]);
  await query(`DELETE FROM leveling_xp_events WHERE guild_id = ?`, [interaction.guildId]);
  await query(`DELETE FROM leveling_role_rewards WHERE guild_id = ?`, [interaction.guildId]);
  await query(`DELETE FROM leveling_settings WHERE guild_id = ?`, [interaction.guildId]);
  invalidateGuildLevelingCache(interaction.guildId);

  return interaction.reply({
    content: '✅ Leveling has been fully deactivated and all leveling data was deleted for this server.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleRoles(interaction) {
  const level = interaction.options.getInteger('level', true);
  const role = interaction.options.getRole('role', true);
  const limit = await getPremiumLimit(interaction.client, interaction.guildId, FREE_ROLE_LIMIT, PREMIUM_ROLE_LIMIT);

  const rows = await query(
    `SELECT level_required, role_id
     FROM leveling_role_rewards
     WHERE guild_id = ?`,
    [interaction.guildId]
  );

  const hasLevel = rows.some(row => Number(row.level_required) === level);
  if (!hasLevel && rows.length >= limit) {
    return interaction.reply({
      content: `❌ You reached the role reward limit (${limit}).`,
      flags: MessageFlags.Ephemeral
    });
  }

  await query(
    `REPLACE INTO leveling_role_rewards (guild_id, level_required, role_id, updated_at)
     VALUES (?, ?, ?, ?)`,
    [interaction.guildId, level, role.id, Date.now()]
  );

  return interaction.reply({
    content: `✅ Reward role set: level ${level} -> <@&${role.id}>.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleRolesList(interaction) {
  const rows = await query(
    `SELECT level_required, role_id
     FROM leveling_role_rewards
     WHERE guild_id = ?
     ORDER BY level_required ASC`,
    [interaction.guildId]
  );

  if (!rows.length) {
    return interaction.reply({ content: 'No reward roles configured yet.', flags: MessageFlags.Ephemeral });
  }

  const text = rows.map(row => `Level ${row.level_required}: <@&${row.role_id}>`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('Level Reward Roles')
    .setDescription(text);

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleLevelSet(interaction) {
  const user = interaction.options.getUser('user', true);
  const mode = interaction.options.getString('mode', true);
  const levels = interaction.options.getInteger('levels', true);

  const rows = await query(
    `SELECT xp, level
     FROM leveling_users
     WHERE guild_id = ? AND user_id = ?
     LIMIT 1`,
    [interaction.guildId, user.id]
  );

  const currentLevel = Number(rows[0]?.level || 0);
  let nextLevel = currentLevel;

  if (mode === 'set') {
    nextLevel = levels;
  } else if (mode === 'add') {
    nextLevel = currentLevel + levels;
  } else if (mode === 'remove') {
    nextLevel = Math.max(0, currentLevel - levels);
  }

  await query(
    `INSERT INTO leveling_users (guild_id, user_id, xp, level, last_xp_at, updated_at)
     VALUES (?, ?, 0, ?, NULL, ?)
     ON DUPLICATE KEY UPDATE
      level = VALUES(level),
      xp = 0,
      updated_at = VALUES(updated_at)`,
    [interaction.guildId, user.id, nextLevel, Date.now()]
  );

  return interaction.reply({
    content: `✅ Updated ${user} from level ${currentLevel} to level ${nextLevel}.`,
    flags: MessageFlags.Ephemeral
  });
}
