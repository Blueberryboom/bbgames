const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { LOG_EVENT_KEYS, ALL_LOG_EVENT_KEYS, logGuildEvent } = require('../utils/guildLogger');

const LOG_CHOICES = [
  { name: 'Member Joins', value: LOG_EVENT_KEYS.joins },
  { name: 'Member Leaves', value: LOG_EVENT_KEYS.leaves },
  { name: 'Server Boosts', value: LOG_EVENT_KEYS.boosts },
  { name: 'Bot Setting Changes', value: LOG_EVENT_KEYS.bot_setting_changes },
  { name: 'Configuration Changes', value: LOG_EVENT_KEYS.configuration_changes },
  { name: 'Leveling Changes', value: LOG_EVENT_KEYS.leveling_changes },
  { name: 'Server Data Deletions', value: LOG_EVENT_KEYS.data_deletions },
  { name: 'Modules Enabled', value: LOG_EVENT_KEYS.modules_enabled },
  { name: 'Modules Disabled', value: LOG_EVENT_KEYS.modules_disabled },
  { name: '/say Command Used', value: LOG_EVENT_KEYS.say_command_used }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure bot activity logs')
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set the log channel for this server')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for bot activity logs')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sub => {
      sub
        .setName('choose')
        .setDescription('Choose which events are sent to the logs channel');

      for (let i = 0; i < LOG_CHOICES.length; i += 1) {
        sub.addStringOption(option =>
          option
            .setName(`type_${i + 1}`)
            .setDescription(i === 0 ? 'First log type to enable' : 'Additional log type to enable')
            .setRequired(i === 0)
            .addChoices(...LOG_CHOICES)
        );
      }

      return sub;
    })
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable logs entirely (Administrator only)')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'disable') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Only a server administrator can use `/logs disable`.',
          flags: MessageFlags.Ephemeral
        });
      }

      await query(
        `UPDATE guild_logs_settings
         SET enabled = 0, updated_by = ?, updated_at = ?
         WHERE guild_id = ?`,
        [interaction.user.id, Date.now(), interaction.guildId]
      );

      await query('DELETE FROM guild_logs_events WHERE guild_id = ?', [interaction.guildId]);

      return interaction.reply({
        content: '✅ Logging disabled for this server.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!await checkPerms(interaction)) {
      return interaction.reply({
        content: '❌ You need administrator or the configured bot manager role to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      const now = Date.now();

      await query(
        `INSERT INTO guild_logs_settings (guild_id, channel_id, enabled, updated_by, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
           channel_id = VALUES(channel_id),
           enabled = 1,
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, interaction.user.id, now]
      );

      for (const eventKey of ALL_LOG_EVENT_KEYS) {
        await query(
          `INSERT INTO guild_logs_events (guild_id, event_key, enabled, updated_at)
           VALUES (?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
          [interaction.guildId, eventKey, now]
        );
      }

      return interaction.reply({
        content: `✅ Log channel set to <#${channel.id}>.\nNext step: use **/logs choose** to select which events should be logged.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const selected = new Set();
    for (let i = 1; i <= LOG_CHOICES.length; i += 1) {
      const value = interaction.options.getString(`type_${i}`);
      if (value) selected.add(value);
    }

    if (!selected.size) {
      return interaction.reply({
        content: '❌ Select at least one log type.',
        flags: MessageFlags.Ephemeral
      });
    }

    const settingsRows = await query(
      `SELECT channel_id, enabled
       FROM guild_logs_settings
       WHERE guild_id = ?
       LIMIT 1`,
      [interaction.guildId]
    );

    if (!settingsRows.length || Number(settingsRows[0].enabled) !== 1) {
      return interaction.reply({
        content: '❌ Set a log channel first with `/logs channel`.',
        flags: MessageFlags.Ephemeral
      });
    }

    const now = Date.now();
    await query('DELETE FROM guild_logs_events WHERE guild_id = ?', [interaction.guildId]);

    for (const eventKey of ALL_LOG_EVENT_KEYS) {
      const enabled = selected.has(eventKey) ? 1 : 0;
      await query(
        `INSERT INTO guild_logs_events (guild_id, event_key, enabled, updated_at)
         VALUES (?, ?, ?, ?)`,
        [interaction.guildId, eventKey, enabled, now]
      );
    }

    const labels = LOG_CHOICES.filter(choice => selected.has(choice.value)).map(choice => `• ${choice.name}`).join('\n');

    await interaction.reply({
      content: `✅ Log types updated.\n${labels}`,
      flags: MessageFlags.Ephemeral
    });

    await logGuildEvent(
      interaction.client,
      interaction.guildId,
      LOG_EVENT_KEYS.bot_setting_changes,
      {
        title: '⚙️ Log Configuration Updated',
        description: `/logs choose used by <@${interaction.user.id}>.`,
        fields: [
          { name: 'Enabled Types', value: labels || 'None selected' }
        ],
        color: 0x5865F2
      }
    );
  },

  requiredBotPermissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages
  ]
};
