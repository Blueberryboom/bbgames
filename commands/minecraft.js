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
        .setName('monitor_channel_emojis')
        .setDescription('Set emoji prefixes for monitor channel names')
        .addStringOption(o =>
          o.setName('ip_emoji')
            .setDescription('Emoji shown before the IP channel name')
            .setRequired(false)
            .setMaxLength(20)
        )
        .addStringOption(o =>
          o.setName('active_players_emoji')
            .setDescription('Emoji shown before the active players channel name')
            .setRequired(false)
            .setMaxLength(20)
        )
        .addStringOption(o =>
          o.setName('record_emoji')
            .setDescription('Emoji shown before the record channel name')
            .setRequired(false)
            .setMaxLength(20)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop_monitoring')
        .setDescription('Stop Minecraft monitoring and delete monitor channels')
    ),
  requiredBotPermissions(interaction) {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'monitor' || sub === 'stop_monitoring' || sub === 'monitor_channel_emojis') {
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
        content: '⚠️ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'monitor') {
      return handleMonitor(interaction);
    }

    if (sub === 'monitor_channel_emojis') {
      return handleMonitorEmojis(interaction);
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
    return interaction.reply({ content: '⚠️ Could not check that server. Please try again.', flags: MessageFlags.Ephemeral });
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
      content: '⚠️ Enable at least one display option so there is something to monitor.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let currentPlayers = 0;
  let maxPlayers = 0;
  let lastOnline = 0;

  try {
    const stats = await fetchMinecraftServerStats(ip);
    currentPlayers = stats.currentPlayers;
    maxPlayers = stats.maxPlayers;
    lastOnline = stats.online ? 1 : 0;
  } catch {
    lastOnline = 0;
  }

  const existingRows = await query(
    `SELECT ip_channel_id, players_channel_id, record_channel_id
     FROM minecraft_monitors
     WHERE guild_id = ?
     LIMIT 1`,
    [guild.id]
  );

  if (existingRows.length) {
    const cleanupResult = await deleteMonitorChannels(guild, existingRows[0]);
    if (cleanupResult.failed.length) {
      console.warn(
        `⚠️ Minecraft monitor cleanup had ${cleanupResult.failed.length} channel deletion failure(s) in guild ${guild.id}:`,
        cleanupResult.failed
      );
    }
  }

  const now = Date.now();
  await query(
    `REPLACE INTO minecraft_monitors
     (guild_id, server_ip, display_ip, display_player_count, display_max_players, display_player_record,
      ip_channel_id, players_channel_id, record_channel_id, ip_emoji, players_emoji, record_emoji,
      current_players, max_players, player_record, last_online, last_checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
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
      lastOnline,
      now,
      now
    ]
  );

  await syncGuildMonitor(interaction.client, guild.id);

  return interaction.editReply(
    '✅ Minecraft monitor configured. Existing monitor settings (if any) were overwritten, and channels will update every 5 minutes.\nℹ️ For reliable monitoring, the bot needs **View Channel** and **Manage Channels** where you run this command and on the monitor channels (channel/category overwrites can still block it).'
  );
}


async function handleMonitorEmojis(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ipEmoji = interaction.options.getString('ip_emoji')?.trim() || null;
  const playersEmoji = interaction.options.getString('active_players_emoji')?.trim() || null;
  const recordEmoji = interaction.options.getString('record_emoji')?.trim() || null;

  const rows = await query(
    `SELECT guild_id
     FROM minecraft_monitors
     WHERE guild_id = ?
     LIMIT 1`,
    [interaction.guildId]
  );

  if (!rows.length) {
    return interaction.editReply({
      content: '⚠️ Set up monitoring first with `/minecraft monitor`.'
    });
  }

  await query(
    `UPDATE minecraft_monitors
     SET ip_emoji = ?,
         players_emoji = ?,
         record_emoji = ?,
         updated_at = ?
     WHERE guild_id = ?`,
    [ipEmoji, playersEmoji, recordEmoji, Date.now(), interaction.guildId]
  );

  await syncGuildMonitor(interaction.client, interaction.guildId);

  return interaction.editReply({
    content: '✅ Updated Minecraft monitor channel emoji prefixes and forced an immediate monitor refresh.'
  });
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

  const cleanupResult = await deleteMonitorChannels(guild, rows[0]);

  if (cleanupResult.failed.length) {
    return interaction.reply({
      content: `⚠️ I could not delete ${cleanupResult.failed.length} monitor channel(s), so I kept the saved config.\n` +
        `Give me **Manage Channels** permission and run \`/minecraft stop_monitoring\` again.\n` +
        `Debug: ${cleanupResult.failed.map(f => `${f.channelId} (${f.reason})`).join(', ')}`,
      flags: MessageFlags.Ephemeral
    });
  }

  await query('DELETE FROM minecraft_monitors WHERE guild_id = ?', [guild.id]);

  return interaction.reply({
    content: `✅ Stopped Minecraft monitoring. Deleted ${cleanupResult.deleted.length} channel(s), ${cleanupResult.missing.length} were already missing, and removed saved monitor data.`,
    flags: MessageFlags.Ephemeral
  });
}
