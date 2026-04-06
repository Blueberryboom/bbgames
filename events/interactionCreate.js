const { query } = require('../database/index');
const {
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  EmbedBuilder,
  ButtonStyle,
  ComponentType,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const youtubeSetupState = require('../utils/youtubeSetupState');
const rpsState = require('../utils/rpsState');
const { trackAchievementEvent } = require('../utils/achievementManager');
const { getPremiumLimit } = require('../utils/premiumPerks');
const checkPerms = require('../utils/checkEventPerms');
const {
  parseRoleIds,
  getGuildTicketSettings,
  getTicketTypeById,
  buildTicketControls,
  ensureTicketCategory,
  refreshWorkloadPanel
} = require('../utils/ticketSystem');
const {
  resolveRequiredPermissions,
  getMissingPermissions,
  replyMissingPermissions,
  isMissingPermissionsError,
  DEFAULT_REQUIRED_PERMISSIONS
} = require('../utils/permissionGuard');

const HELP_MODULES = {
  counting: {
    name: 'Counting',
    value: 'Commands: `/count current`, `/count channel`, `/count leaderboard`, `/count removechannel`, `/count reset`, `/count set`.'
  },
  giveaways: {
    name: 'Giveaways',
    value: 'Command: `/giveaway` to start and manage giveaways with role options.'
  },
  fun: {
    name: 'Fun',
    value: 'Commands: `/coinflip`, `/dadjoke`, `/dice`, `/tictactoe`, `/rps`.'
  },
  youtube: {
    name: 'YouTube',
    value: 'Command: `/youtube` with add/remove/list for upload notifications.'
  },
  tags: {
    name: 'Tags',
    value: 'Commands: `/tag send`, `/tag create`, `/tags usage`.'
  },
  onewordstory: {
    name: 'One Word Story',
    value: 'Commands: `/onewordstory channel`, `/onewordstory delay`, `/onewordstory disable`, `/onewordstory view`, `/onewordstory restart`, `/onewordstory leaderboard`.'
  },
  misc: {
    name: 'Misc',
    value: 'Commands: `/help`, `/about`, `/status`, `/support`, `/minecraft`, `/donate`, `/config`, `/sticky`, `/automsg`, `/afk`, `/afk_leaderboard`, `/birthday`, `/leveling`, `/level`, `/premium`, `/owner`, `/variableslowmode`, `/welcome`, `/leave`, `/boostmsg`, `/logs`, `/starboard`, `/servertag`, `/dice`, `/tictactoe`.'
  }
};
const RPS_CHOICE_EMOJI = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️'
};

module.exports = async (interaction) => {

  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    const isGuildInteraction = interaction.inGuild();
    const requiredPermissions = isGuildInteraction
      ? resolveRequiredPermissions(command, interaction)
      : [];
    const missingPermissions = isGuildInteraction
      ? getMissingPermissions(interaction, requiredPermissions)
      : [];

    if (missingPermissions.length) {
      await replyMissingPermissions(interaction, missingPermissions);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      if (isMissingPermissionsError(err) && isGuildInteraction) {
        const fallbackMissing = getMissingPermissions(interaction, requiredPermissions);
        await replyMissingPermissions(
          interaction,
          fallbackMissing.length ? fallbackMissing : requiredPermissions
        );
        return;
      }

      console.error('❌ Slash command error:', err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ ${err.message || 'Command failed.'}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'help_category') {
    const key = interaction.values[0];
    const moduleData = HELP_MODULES[key];

    if (!moduleData) {
      return interaction.reply({ content: '❌ Unknown help category.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`Help • ${moduleData.name}`)
      .setDescription(moduleData.value);

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'config_menu') {
    const key = interaction.values[0];

    if (key === 'permissions') {
      return interaction.reply({
        content: 'Use `/config bot_manager_role` for global management access and `/config giveaway_admin_role` for giveaway-only access.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (key === 'messages') {
      return interaction.reply({
        content: 'Use `/config system_messages` to enable or disable system announcements.',
        flags: MessageFlags.Ephemeral
      });
    }

    return interaction.reply({ content: '❌ Unknown config menu.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_panel_select') {
    return handleTicketPanelSelect(interaction);
  }

  if (!interaction.isButton()) return;

  try {
    if (interaction.customId.startsWith('youtube_test_') || interaction.customId.startsWith('youtube_confirm_')) {
      const [, action, token] = interaction.customId.split('_');
      const pendingConfig = youtubeSetupState.get(token);

      if (!pendingConfig) {
        return interaction.reply({
          content: '❌ This setup preview expired. Please run `/youtube add` again.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (pendingConfig.userId !== interaction.user.id || pendingConfig.guildId !== interaction.guildId) {
        return interaction.reply({
          content: '❌ This setup preview belongs to a different user or server.',
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = await interaction.guild.channels.fetch(pendingConfig.targetChannelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: '❌ The selected channel no longer exists.', flags: MessageFlags.Ephemeral });
      }

      if (action === 'test') {
        const ping = pendingConfig.pingRoleId ? `<@&${pendingConfig.pingRoleId}> ` : '';
        await channel.send({
          content: `${ping}**${pendingConfig.youtubeDisplay}** just uploaded a video on **YouTube**! Check it out!`,
          embeds: [
            new EmbedBuilder()
              .setColor('#ff0000')
              .setTitle('Test Notification')
              .setDescription('This is a preview test message. No subscription was created yet.')
          ],
          allowedMentions: pendingConfig.pingRoleId ? { parse: [], roles: [pendingConfig.pingRoleId] } : { parse: [] }
        });

        return interaction.reply({ content: '✅ Test message sent.', flags: MessageFlags.Ephemeral });
      }

      const existingRows = await query(
        `SELECT youtube_channel_id FROM youtube_subscriptions WHERE guild_id = ?`,
        [interaction.guildId]
      );

      const maxSubscriptions = await getPremiumLimit(interaction.client, interaction.guildId, 5, 25);

      if (existingRows.length >= maxSubscriptions) {
        return interaction.reply({
          content: `❌ This server already has ${maxSubscriptions} YouTube channels configured.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const duplicate = existingRows.some(row => row.youtube_channel_id === pendingConfig.youtubeChannelId);
      if (duplicate) {
        return interaction.reply({ content: '❌ This YouTube channel is already configured.', flags: MessageFlags.Ephemeral });
      }

      await query(
        `REPLACE INTO youtube_subscriptions
         (guild_id, youtube_channel_id, discord_channel_id, ping_role_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          pendingConfig.guildId,
          pendingConfig.youtubeChannelId,
          pendingConfig.targetChannelId,
          pendingConfig.pingRoleId,
          Date.now()
        ]
      );

      youtubeSetupState.consume(token);

      return interaction.reply({
        content: `✅ Created notification for **${pendingConfig.youtubeDisplay}** in <#${pendingConfig.targetChannelId}>.`,
        flags: MessageFlags.Ephemeral
      });
    }


    if (interaction.customId.startsWith('rps_pick_')) {
      const [, , gameId, choice] = interaction.customId.split('_');
      const game = rpsState.getGame(gameId);

      if (!game) {
        return interaction.reply({
          content: '❌ This RPS challenge expired. Start a new one with `/rps`.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.guildId !== game.guildId || interaction.user.id !== game.opponentId) {
        return interaction.reply({
          content: '❌ Only the challenged user can respond to this game.',
          flags: MessageFlags.Ephemeral
        });
      }

      rpsState.consumeGame(gameId);

      const challenger = await interaction.client.users.fetch(game.challengerId).catch(() => null);
      const firstUserMention = challenger ? `<@${challenger.id}>` : `<@${game.challengerId}>`;
      const secondUserMention = `<@${interaction.user.id}>`;
      const firstName = challenger?.username || game.challengerId;
      const secondName = interaction.user.username;
      const result = decideRpsWinner(game.challengerChoice, choice);

      const resultEmoji = result === 'draw' ? '🤝' : result === 'first' ? '🏆' : '💥';
      const summary = result === 'draw'
        ? 'It is a draw!'
        : result === 'first'
          ? `${firstName} wins!`
          : `${secondName} wins!`;

      const embed = new EmbedBuilder()
        .setColor(result === 'draw' ? 0xFEE75C : result === 'first' ? 0x57F287 : 0xED4245)
        .setTitle(`${resultEmoji} Rock Paper Scissors`)
        .setDescription(
          `**${firstName}:** ${RPS_CHOICE_EMOJI[game.challengerChoice] || ''} ${game.challengerChoice}\n` +
          `**${secondName}:** ${RPS_CHOICE_EMOJI[choice] || ''} ${choice}\n\n` +
          `${firstUserMention} vs ${secondUserMention}\n` +
          `**Result:** ${summary}`
        );

      await interaction.update({
        embeds: [embed],
        content: '',
        components: []
      });

      if (result === 'first') {
        await trackAchievementEvent({
          userId: game.challengerId,
          event: 'rps_win',
          context: {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            channel: interaction.channel,
            userMention: firstUserMention
          }
        });
      } else if (result === 'second') {
        await trackAchievementEvent({
          userId: interaction.user.id,
          event: 'rps_win',
          context: {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            channel: interaction.channel,
            userMention: secondUserMention
          }
        });
      }

      return;
    }

    if (
      interaction.customId.startsWith('ticket_open_confirm:')
      || interaction.customId.startsWith('ticket_open_cancel:')
      || interaction.customId.startsWith('ticket_claim:')
      || interaction.customId.startsWith('ticket_close:')
      || interaction.customId.startsWith('ticket_close_reason:')
      || interaction.customId.startsWith('ticket_close_request_yes:')
    ) {
      return handleTicketButtons(interaction);
    }

    const parts = interaction.customId.split('_');
    if (parts.length < 3 || parts[0] !== 'giveaway') return;

    const action = parts[1];
    const giveawayId = parts.slice(2).join('_');

    // Acknowledge giveaway button interactions immediately to avoid Discord's
    // 3-second timeout causing "Unknown interaction" API errors.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const rows = await query(
      `SELECT * FROM giveaways WHERE id = ?`,
      [giveawayId]
    );

    if (!rows || rows.length === 0) {
      return replyToButton(interaction, 'Giveaway not found.');
    }

    const giveaway = rows[0];

    if (action === 'participants') {
      return showGiveawayParticipants(interaction, giveawayId, giveaway);
    }

    if (giveaway.ended) {
      return replyToButton(interaction, '❌ This giveaway has already ended.');
    }

    if (action === 'join') {
      if (giveaway.required_role) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(giveaway.required_role)) {
          return replyToButton(interaction, `❌ You need <@&${giveaway.required_role}> to enter this giveaway.`);
        }
      }

      const existing = await query(
        `SELECT 1 FROM giveaway_entries
         WHERE giveaway_id = ? AND user_id = ?`,
        [giveawayId, interaction.user.id]
      );

      let feedback;

      if (existing.length > 0) {
        await query(
          `DELETE FROM giveaway_entries
           WHERE giveaway_id = ? AND user_id = ?`,
          [giveawayId, interaction.user.id]
        );

        feedback = '✅ You have left the giveaway and all of your entries were removed.';
      } else {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const entryCount = getEntryCount(member, giveaway.extra_entries);

        await query(
          `INSERT INTO giveaway_entries (giveaway_id, user_id, entry_count)
           VALUES (?, ?, ?)`,
          [giveawayId, interaction.user.id, entryCount]
        );

        feedback = entryCount > 1
          ? `✅ You have joined the giveaway with **${entryCount} entries**!`
          : '✅ You have joined the giveaway!';
      }

      await refreshParticipantButton(interaction, giveawayId);

      await replyToButton(interaction, feedback);

      return;
    }

  } catch (err) {
    if (isMissingPermissionsError(err)) {
      const missingPermissions = getMissingPermissions(interaction, DEFAULT_REQUIRED_PERMISSIONS);
      await replyMissingPermissions(
        interaction,
        missingPermissions.length ? missingPermissions : DEFAULT_REQUIRED_PERMISSIONS
      );
      return;
    }

    console.error('❌ Button interaction error:', err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
};

function getEntryCount(member, extraEntriesRaw) {
  if (!member || !extraEntriesRaw) return 1;

  let parsed = extraEntriesRaw;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return 1;
    }
  }

  if (Array.isArray(parsed)) {
    let entryCount = 1;

    for (const rule of parsed) {
      const roleId = rule?.roleId || rule?.bonusRoleId;
      const multiplier = Number(rule?.multiplier || 1);

      if (roleId && multiplier > 1 && member.roles.cache.has(roleId)) {
        entryCount += (multiplier - 1);
      }
    }

    return Math.max(1, entryCount);
  }

  const legacyRoleId = parsed?.bonusRoleId;
  const legacyMultiplier = Number(parsed?.multiplier || 1);

  if (legacyRoleId && legacyMultiplier > 1 && member.roles.cache.has(legacyRoleId)) {
    return legacyMultiplier;
  }

  return 1;
}

async function handleTicketPanelSelect(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: '❌ This menu can only be used in a server.', flags: MessageFlags.Ephemeral });
  }

  const value = interaction.values?.[0] || '';
  if (!value.startsWith('type_')) {
    return interaction.reply({ content: '❌ Unknown ticket type.', flags: MessageFlags.Ephemeral });
  }

  const typeId = Number(value.slice(5));
  if (!Number.isFinite(typeId)) {
    return interaction.reply({ content: '❌ Invalid ticket type id.', flags: MessageFlags.Ephemeral });
  }

  const settings = await getGuildTicketSettings(interaction.guildId);
  if (!settings?.category_id) {
    return interaction.reply({ content: '❌ Ticket system is not configured yet.', flags: MessageFlags.Ephemeral });
  }

  const type = await getTicketTypeById(interaction.guildId, typeId);
  if (!type) {
    return interaction.reply({ content: '❌ That ticket type no longer exists.', flags: MessageFlags.Ephemeral });
  }

  const allowedRoles = parseRoleIds(type.allowed_role_ids);
  if (allowedRoles.length && !allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId))) {
    return interaction.reply({
      content: '❌ You do not have permission to open this ticket type.',
      flags: MessageFlags.Ephemeral
    });
  }

  const isBlacklisted = await query(
    `SELECT 1 FROM ticket_blacklist WHERE guild_id = ? AND user_id = ? LIMIT 1`,
    [interaction.guildId, interaction.user.id]
  );
  if (isBlacklisted.length) {
    return interaction.reply({ content: '❌ You are blacklisted from opening tickets in this server.', flags: MessageFlags.Ephemeral });
  }

  const maxTickets = Math.min(5, Math.max(1, Number(settings.max_tickets_per_user || 1)));
  const openRows = await query(
    `SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND user_id = ?`,
    [interaction.guildId, interaction.user.id]
  );
  const openCount = Number(openRows[0]?.total || 0);
  if (openCount >= maxTickets) {
    return interaction.reply({ content: `❌ You already have ${openCount}/${maxTickets} open tickets.`, flags: MessageFlags.Ephemeral });
  }

  const cooldownMs = Math.max(0, Number(settings.creation_cooldown_ms || 0));
  if (cooldownMs > 0) {
    const activityRows = await query(
      `SELECT last_opened_at FROM ticket_user_activity WHERE guild_id = ? AND user_id = ? LIMIT 1`,
      [interaction.guildId, interaction.user.id]
    );
    const lastOpenedAt = Number(activityRows[0]?.last_opened_at || 0);
    const remaining = lastOpenedAt + cooldownMs - Date.now();
    if (remaining > 0) {
      return interaction.reply({
        content: `⏳ You can open another ticket <t:${Math.floor((Date.now() + remaining) / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_open_confirm:${type.id}`)
      .setLabel('✅ Yes')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket_open_cancel:${type.id}`)
      .setLabel('❌ No')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({
    content: `Open a **${type.name}** ticket?`,
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketButtons(interaction) {
  if (interaction.customId.startsWith('ticket_open_cancel:')) {
    return interaction.update({ content: 'Cancelled ticket creation.', components: [] });
  }

  if (interaction.customId.startsWith('ticket_open_confirm:')) {
    const typeId = Number(interaction.customId.split(':')[1]);
    const type = await getTicketTypeById(interaction.guildId, typeId);
    const settings = await getGuildTicketSettings(interaction.guildId);

    if (!type || !settings?.category_id) {
      return interaction.update({ content: '❌ Ticket setup is missing or invalid.', components: [] });
    }

    const category = await ensureTicketCategory(interaction.guild, settings.category_id);
    if (!category) {
      return interaction.update({ content: '❌ The configured ticket category is missing. Ask staff to run `/ticket config` again.', components: [] });
    }

    const staffRoleIds = parseRoleIds(type.staff_role_ids);
    const ticketName = `${type.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 70)}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'user'}`;

    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ];

    for (const roleId of staffRoleIds) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      });
    }

    const channel = await interaction.guild.channels.create({
      name: ticketName.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${interaction.user.tag} (${interaction.user.id})`
    }).catch(() => null);

    if (!channel) {
      return interaction.update({ content: '❌ Failed to create the ticket channel. Check bot permissions.', components: [] });
    }

    const now = Date.now();
    const insert = await query(
      `INSERT INTO tickets (guild_id, channel_id, user_id, type_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [interaction.guildId, channel.id, interaction.user.id, type.id, now]
    );
    const ticketId = Number(insert.insertId);
    const controls = buildTicketControls(ticketId);

    await query(
      `REPLACE INTO ticket_user_activity (guild_id, user_id, last_opened_at)
       VALUES (?, ?, ?)`,
      [interaction.guildId, interaction.user.id, now]
    );

    const pingRoles = staffRoleIds.map(id => `<@&${id}>`).join(' ');
    const content = `${interaction.user} ${pingRoles}`.trim();
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(type.name)
      .setDescription(type.welcome_message);

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(controls.claim).setLabel('🙋 Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(controls.close).setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(controls.closeReason).setLabel('📝 Close With Reason').setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content,
      embeds: [embed],
      components: [actionRow],
      allowedMentions: { users: [interaction.user.id], roles: staffRoleIds }
    });

    if (settings?.transcripts_channel_id) {
      const transcriptsChannel = await interaction.guild.channels.fetch(settings.transcripts_channel_id).catch(() => null);
      if (transcriptsChannel?.isTextBased()) {
        const creationEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('Ticket Created')
          .setDescription(`Ticket #${ticketId} was created.`)
          .addFields(
            { name: 'Type', value: type.name, inline: true },
            { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Channel', value: `<#${channel.id}>`, inline: true }
          )
          .setTimestamp(new Date(now));

        const creationMessage = await transcriptsChannel.send({ embeds: [creationEmbed] }).catch(() => null);
        if (creationMessage && typeof creationMessage.startThread === 'function') {
          const thread = await creationMessage.startThread({
            name: `ticket-${ticketId}-${type.name}`.slice(0, 100),
            autoArchiveDuration: 10080
          }).catch(() => null);

          if (thread?.id) {
            await query('UPDATE tickets SET transcript_thread_id = ? WHERE id = ?', [thread.id, ticketId]);
          }
        }
      }
    }

    await refreshWorkloadPanel(interaction.guild);
    return interaction.update({ content: `✅ Your ticket has been created: ${channel}`, components: [] });
  }

  if (interaction.customId.startsWith('ticket_claim:')) {
    const ticketId = Number(interaction.customId.split(':')[1]);
    const rows = await query(
      `SELECT t.*, tt.staff_role_ids
       FROM tickets t
       INNER JOIN ticket_types tt ON tt.guild_id = t.guild_id AND tt.id = t.type_id
       WHERE t.id = ? AND t.guild_id = ? LIMIT 1`,
      [ticketId, interaction.guildId]
    );
    const ticket = rows[0];
    if (!ticket) {
      return interaction.reply({ content: '❌ Ticket not found or already closed.', flags: MessageFlags.Ephemeral });
    }

    const settings = await getGuildTicketSettings(interaction.guildId);
    if (!Number(settings?.claiming_enabled || 0)) {
      return interaction.reply({ content: '❌ Ticket claiming is disabled by configuration.', flags: MessageFlags.Ephemeral });
    }

    const staffRoles = parseRoleIds(ticket.staff_role_ids);
    const isStaff = await checkPerms(interaction) || staffRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    if (!isStaff) {
      return interaction.reply({ content: '❌ Only ticket staff can claim tickets.', flags: MessageFlags.Ephemeral });
    }

    await query('UPDATE tickets SET claimed_by = ? WHERE id = ?', [interaction.user.id, ticketId]);
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setDescription(`✅ ${interaction.user} claimed this ticket.`);
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.customId.startsWith('ticket_close_reason:')) {
    const ticketId = Number(interaction.customId.split(':')[1]);
    await interaction.reply({
      content: '📝 Please type the close reason in this ticket within **30 seconds**. I will only accept your message.',
      flags: MessageFlags.Ephemeral
    });

    const reasonMessage = await interaction.channel.awaitMessages({
      filter: msg => msg.author.id === interaction.user.id,
      max: 1,
      time: 30_000
    }).catch(() => null);

    const reason = reasonMessage?.first()?.content?.trim();
    if (!reason) {
      return interaction.followUp({
        content: '⏱️ No close reason received in time. Ticket close cancelled.',
        flags: MessageFlags.Ephemeral
      });
    }

    return closeTicket(interaction, ticketId, reason.slice(0, 1000));
  }

  if (interaction.customId.startsWith('ticket_close_request_yes:')) {
    const ticketId = Number(interaction.customId.split(':')[1]);
    const rows = await query('SELECT user_id FROM tickets WHERE id = ? AND guild_id = ? LIMIT 1', [ticketId, interaction.guildId]);
    const ticket = rows[0];
    if (!ticket) {
      return interaction.reply({ content: '❌ Ticket no longer exists.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== ticket.user_id) {
      return interaction.reply({ content: '❌ Only the ticket owner can confirm this close request.', flags: MessageFlags.Ephemeral });
    }
    return closeTicket(interaction, ticketId, 'Closed by owner approval from close request.');
  }

  if (interaction.customId.startsWith('ticket_close:')) {
    const ticketId = Number(interaction.customId.split(':')[1]);
    return closeTicket(interaction, ticketId, null);
  }
}

async function closeTicket(interaction, ticketId, closeReason) {
  const rows = await query(
    `SELECT t.*, tt.name AS type_name, tt.staff_role_ids
     FROM tickets t
     INNER JOIN ticket_types tt ON tt.guild_id = t.guild_id AND tt.id = t.type_id
     WHERE t.id = ? AND t.guild_id = ? LIMIT 1`,
    [ticketId, interaction.guildId]
  );
  const ticket = rows[0];
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket not found or already closed.', flags: MessageFlags.Ephemeral });
  }

  const isOwner = interaction.user.id === ticket.user_id;
  const isStaff = await checkPerms(interaction) || parseRoleIds(ticket.staff_role_ids).some(roleId => interaction.member.roles.cache.has(roleId));
  if (!isOwner && !isStaff) {
    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', flags: MessageFlags.Ephemeral });
  }

  const channel = interaction.guild.channels.cache.get(ticket.channel_id) || await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
  const settings = await getGuildTicketSettings(interaction.guildId);

  if (settings?.transcripts_channel_id && channel?.isTextBased()) {
    const transcriptChannel = await interaction.guild.channels.fetch(settings.transcripts_channel_id).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      let transcriptTarget = transcriptChannel;
      if (ticket.transcript_thread_id) {
        const transcriptThread = await interaction.guild.channels.fetch(ticket.transcript_thread_id).catch(() => null);
        if (transcriptThread?.isTextBased()) {
          transcriptTarget = transcriptThread;
        }
      }

      const messages = await fetchTranscriptMessages(channel);
      const header = [
        `Ticket #${ticketId}`,
        `Type: ${ticket.type_name}`,
        `Owner: ${ticket.user_id}`,
        `Closed by: ${interaction.user.id}`,
        `Closed at: ${new Date().toISOString()}`,
        `Reason: ${closeReason || 'No reason provided'}`,
        '---'
      ];
      const body = messages.map(msg => {
        const clean = (msg.content || '').replace(/\\s+/g, ' ').trim();
        const attachments = msg.attachments?.map(a => a.url).join(' ') || '';
        return `[${new Date(msg.createdTimestamp).toISOString()}] ${msg.author?.tag || msg.author?.id || 'unknown'}: ${clean} ${attachments}`.trim();
      });
      const text = `${header.join('\n')}\n${body.join('\n')}`.slice(0, 1900000);
      const chunks = [];
      for (let i = 0; i < text.length; i += 1800) {
        chunks.push(text.slice(i, i + 1800));
      }

      await transcriptTarget.send({ content: `🧾 Ticket transcript for <#${ticket.channel_id}>` }).catch(() => null);
      for (let i = 0; i < Math.min(chunks.length, 12); i++) {
        await transcriptTarget.send({ content: `\`\`\`\n${chunks[i]}\n\`\`\`` }).catch(() => null);
      }
      if (chunks.length > 12) {
        await transcriptTarget.send({
          content: `... transcript truncated (${chunks.length - 12} additional chunk(s) omitted to avoid spam).`
        }).catch(() => null);
      }

      const closeEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('Ticket Closed')
        .setDescription(`Ticket #${ticketId} has been closed.`)
        .addFields(
          { name: 'Type', value: ticket.type_name, inline: true },
          { name: 'Owner', value: `<@${ticket.user_id}>`, inline: true },
          { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: closeReason || 'No reason provided', inline: false }
        )
        .setTimestamp(new Date());

      await transcriptChannel.send({ embeds: [closeEmbed] }).catch(() => null);
    }
  }

  await query('DELETE FROM tickets WHERE id = ?', [ticketId]);
  if (channel) {
    await channel.delete(`Ticket closed by ${interaction.user.tag} (${interaction.user.id})`).catch(() => null);
  }

  await refreshWorkloadPanel(interaction.guild);

  const responseText = `✅ Closed ticket #${ticketId}${closeReason ? ` with reason: ${closeReason}` : '.'}`;
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content: responseText, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content: responseText, flags: MessageFlags.Ephemeral });
}

async function fetchTranscriptMessages(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    const values = [...batch.values()];
    all.push(...values);
    before = values[values.length - 1].id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

function decideRpsWinner(first, second) {
  if (first === second) return 'draw';
  if (
    (first === 'rock' && second === 'scissors')
    || (first === 'paper' && second === 'rock')
    || (first === 'scissors' && second === 'paper')
  ) {
    return 'first';
  }
  return 'second';
}

async function refreshParticipantButton(interaction, giveawayId) {
  const countRows = await query(
    `SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?`,
    [giveawayId]
  );

  const total = Number(countRows[0]?.total || 0);

  const rows = interaction.message.components.map(row =>
    new ActionRowBuilder().addComponents(
      row.components.map(component => {
        if (component.customId === `giveaway_participants_${giveawayId}`) {
          return ButtonBuilder.from(component).setLabel(`Participants (${total})`);
        }
        return ButtonBuilder.from(component);
      })
    )
  );

  await interaction.message.edit({ components: rows }).catch(() => {});
}

async function replyToButton(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }

  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
}

async function showGiveawayParticipants(interaction, giveawayId, giveaway) {
  const rows = await query(
    `SELECT user_id, entry_count
     FROM giveaway_entries
     WHERE giveaway_id = ?
     ORDER BY entry_count DESC, user_id ASC`,
    [giveawayId]
  );

  if (!rows.length) {
    return replyToButton(interaction, '👥 No one has entered this giveaway yet.');
  }

  let page = 0;
  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const customBase = `gparticipants:${giveawayId}:${interaction.id}`;

  const totalEntries = rows.reduce((sum, row) => sum + Math.max(1, Number(row.entry_count || 1)), 0);

  const buildEmbed = () => {
    const slice = rows.slice(page * perPage, (page + 1) * perPage);
    const lines = slice.map((row, index) => {
      const rank = page * perPage + index + 1;
      const entryCount = Math.max(1, Number(row.entry_count || 1));
      const chance = ((entryCount / totalEntries) * 100).toFixed(2);
      return `#${rank} <@${row.user_id}> — ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}\n↳ Chance: **${chance}%**`;
    });

    const myEntryCount = rows
      .filter(row => row.user_id === interaction.user.id)
      .reduce((sum, row) => sum + Math.max(1, Number(row.entry_count || 1)), 0);
    const myChance = myEntryCount > 0
      ? `${((myEntryCount / totalEntries) * 100).toFixed(2)}% (${myEntryCount} ${myEntryCount === 1 ? 'entry' : 'entries'})`
      : 'Not entered';

    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`👥 Giveaway Participants (${rows.length})`)
      .setDescription(lines.join('\n\n'))
      .addFields(
        { name: 'Prize', value: `**${giveaway.prize}**`, inline: false },
        { name: 'Your Chance', value: myChance, inline: true },
        { name: 'Total Entries', value: `${totalEntries}`, inline: true }
      )
      .setFooter({ text: `Page ${page + 1} / ${totalPages}` });
  };

  const buildComponents = () => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customBase}:left`)
        .setLabel('⬅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1),
      new ButtonBuilder()
        .setCustomId(`${customBase}:me`)
        .setLabel('Find Me')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${customBase}:right`)
        .setLabel('➡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1)
    )
  ];

  await interaction.editReply({
    embeds: [buildEmbed()],
    components: buildComponents(),
    content: ''
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on('collect', async i => {
    if (!i.customId.startsWith(customBase)) return;

    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: '❌ This participant list is only for the user who opened it.', flags: MessageFlags.Ephemeral });
    }

    if (i.customId.endsWith(':left')) {
      page = (page - 1 + totalPages) % totalPages;
      return i.update({ embeds: [buildEmbed()], components: buildComponents() });
    }

    if (i.customId.endsWith(':right')) {
      page = (page + 1) % totalPages;
      return i.update({ embeds: [buildEmbed()], components: buildComponents() });
    }

    const index = rows.findIndex(row => row.user_id === i.user.id);
    if (index === -1) {
      return i.reply({ content: 'You are not entered in this giveaway.', flags: MessageFlags.Ephemeral });
    }

    page = Math.floor(index / perPage);
    return i.update({ embeds: [buildEmbed()], components: buildComponents() });
  });

  collector.on('end', async () => {
    await message.edit({ components: [] }).catch(() => null);
  });
}
