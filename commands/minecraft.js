const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const {
  fetchMinecraftServerStats,
  syncGuildMonitor,
  deleteMonitorChannels
} = require('../utils/minecraftMonitorManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minecraft')
    .setDescription('Check Minecraft server status')
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check if a Minecraft server is online')
        .addStringOption(o =>
          o.setName('server')
            .setDescription('Server domain or IP')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('monitor')
        .setDescription('Create a live Minecraft monitor with voice channels')
        .addStringOption(o =>
          o.setName('ip')
            .setDescription('Server domain or IP')
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o.setName('display_ip')
            .setDescription('Display IP channel')
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o.setName('display_player_count')
            .setDescription('Display current player count')
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o.setName('display_max_players')
            .setDescription('Include max players in count channel')
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o.setName('display_player_count_record')
            .setDescription('Display all-time record player count')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop_monitoring')
        .setDescription('Stop Minecraft monitoring and delete monitor channels')
    ),
  requiredBotPermissions(interaction) {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'monitor' || sub === 'stop_monitoring') {
      return [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels
      ];
    }

    return [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ];
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      return handleStatus(interaction);
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'monitor') {
      return handleMonitor(interaction);
    }

    if (sub === 'stop_monitoring') {
      return handleStopMonitoring(interaction);
    }
  }
};

async function handleStatus(interaction) {
  const server = interaction.options.getString('server').trim();

  try {
    const stats = await fetchMinecraftServerStats(server);

    const embed = new EmbedBuilder()
      .setColor(stats.online ? 0x57F287 : 0xED4245)
      .setTitle(`Minecraft Status • ${server}`)
      .addFields(
        { name: 'Status', value: stats.online ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Players', value: `${stats.currentPlayers}/${stats.maxPlayers}`, inline: true }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch {
    return interaction.reply({ content: '❌ Could not check that server. Please try again.', flags: MessageFlags.Ephemeral });
  }
}

async function handleMonitor(interaction) {
  const guild = interaction.guild;
  const ip = interaction.options.getString('ip', true).trim();
  const displayIp = interaction.options.getBoolean('display_ip', true);
  const displayPlayerCount = interaction.options.getBoolean('display_player_count', true);
  const displayMaxPlayers = interaction.options.getBoolean('display_max_players', true);
  const displayPlayerRecord = interaction.options.getBoolean('display_player_count_record', true);

  if (!displayIp && !displayPlayerCount && !displayPlayerRecord) {
    return interaction.reply({
      content: '❌ Enable at least one display option so there is something to monitor.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let currentPlayers = 0;
  let maxPlayers = 0;

  try {
    const stats = await fetchMinecraftServerStats(ip);
    currentPlayers = stats.currentPlayers;
    maxPlayers = stats.maxPlayers;
  } catch {
    return interaction.editReply('❌ Could not reach that Minecraft server right now.');
  }

  const existingRows = await query(
    `SELECT ip_channel_id, players_channel_id, record_channel_id
     FROM minecraft_monitors
     WHERE guild_id = ?
     LIMIT 1`,
    [guild.id]
  );

  if (existingRows.length) {
    await deleteMonitorChannels(guild, existingRows[0]);
  }

  const now = Date.now();
  await query(
    `REPLACE INTO minecraft_monitors
     (guild_id, server_ip, display_ip, display_player_count, display_max_players, display_player_record,
      ip_channel_id, players_channel_id, record_channel_id,
      current_players, max_players, player_record, last_online, last_checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 1, ?, ?)`,
    [
      guild.id,
      ip,
      displayIp ? 1 : 0,
      displayPlayerCount ? 1 : 0,
      displayMaxPlayers ? 1 : 0,
      displayPlayerRecord ? 1 : 0,
      currentPlayers,
      maxPlayers,
      currentPlayers,
      now,
      now
    ]
  );

  await syncGuildMonitor(interaction.client, guild.id);

  return interaction.editReply(
    '✅ Minecraft monitor configured. Existing monitor settings (if any) were overwritten, and channels will update every 5 minutes.'
  );
}

async function handleStopMonitoring(interaction) {
  const guild = interaction.guild;

  const rows = await query(
    `SELECT ip_channel_id, players_channel_id, record_channel_id
     FROM minecraft_monitors
     WHERE guild_id = ?
     LIMIT 1`,
    [guild.id]
  );

  if (!rows.length) {
    return interaction.reply({
      content: 'ℹ️ This server does not currently have a Minecraft monitor configured.',
      flags: MessageFlags.Ephemeral
    });
  }

  await deleteMonitorChannels(guild, rows[0]);
  await query('DELETE FROM minecraft_monitors WHERE guild_id = ?', [guild.id]);

  return interaction.reply({
    content: '✅ Stopped Minecraft monitoring, deleted monitor channels, and removed saved monitor data.',
    flags: MessageFlags.Ephemeral
  });
}
