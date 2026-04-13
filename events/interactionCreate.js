const { query } = require('../database/index');
const {
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  EmbedBuilder,
  ButtonStyle,
  ComponentType,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
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
  refreshWorkloadPanel,
  allocateGuildTicketDisplayId
} = require('../utils/ticketSystem');
const {
  resolveRequiredPermissions,
  getMissingPermissions,
  replyMissingPermissions,
  isMissingPermissionsError,
  DEFAULT_REQUIRED_PERMISSIONS
} = require('../utils/permissionGuard');
const { canManageSuggestions, getSuggestionSettings, statusLabel } = require('../utils/suggestionSystem');
const suggestCommand = require('../commands/suggest');
const { BUMP_REPORT_CHANNEL_ID } = require('../commands/bump');

const ticketCreateLocks = new Map();

const RPS_CHOICE_EMOJI = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️'
};

module.exports = async (interaction) => {

  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch {
      await interaction.respond([]).catch(() => null);
    }

    return;
  }

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

  if (interaction.isStringSelectMenu() && interaction.customId === 'config_menu') {
    const key = interaction.values[0];

    if (key === 'permissions') {
      return interaction.reply({
        content: 'Use `/config bot_manager_role` for global management access, `/config giveaway_admin_role` for giveaway-only access, and `/config staff_role` for staff moderation access.',
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
    if (interaction.customId === 'suggestions_open_modal') {
      const settings = await getSuggestionSettings(interaction.guildId);
      if (!settings) return interaction.reply({ content: '❌ Suggestions are not configured yet.', flags: MessageFlags.Ephemeral });
      const modal = new ModalBuilder().setCustomId('suggestions_open_modal_submit').setTitle('Create Suggestion');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Suggestion details').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('category').setLabel('Category (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80))
      );
      await interaction.showModal(modal);
      const modalSubmit = await interaction.awaitModalSubmit({
        time: 10 * 60 * 1000,
        filter: submit => submit.customId === 'suggestions_open_modal_submit' && submit.user.id === interaction.user.id
      }).catch(() => null);
      if (!modalSubmit) return;
      return suggestCommand.createSuggestion(modalSubmit, modalSubmit.fields.getTextInputValue('title').trim(), modalSubmit.fields.getTextInputValue('description').trim(), modalSubmit.fields.getTextInputValue('category')?.trim() || null);
    }

    if (interaction.customId === 'suggestion_accept' || interaction.customId === 'suggestion_deny' || interaction.customId === 'suggestion_considering' || interaction.customId === 'suggestion_remove_stale') {
      if (!await canManageSuggestions(interaction)) return interaction.reply({ content: '❌ Only admins, bot managers, or the configured staff role can manage suggestions.', flags: MessageFlags.Ephemeral });
      const rows = await query('SELECT * FROM suggestions WHERE guild_id = ? AND message_id = ? LIMIT 1', [interaction.guildId, interaction.message.id]);
      const suggestion = rows[0];
      if (!suggestion) return interaction.reply({ content: '❌ Suggestion data not found.', flags: MessageFlags.Ephemeral });
      if (interaction.customId === 'suggestion_remove_stale') {
        const embed = EmbedBuilder.from(interaction.message.embeds[0] || new EmbedBuilder());
        const baseColor = suggestion.status === 'accepted' ? 0x57F287 : suggestion.status === 'denied' ? 0xED4245 : 0xFEE75C;
        embed.setColor(baseColor);
        const updatedFields = (embed.data.fields || []).map(field => field.name.toLowerCase() === 'status' ? { ...field, value: statusLabel(suggestion.status) } : field);
        embed.setFields(updatedFields);
        const retainedRows = interaction.message.components.filter(row => !row.components.some(component => component.customId === 'suggestion_remove_stale'));
        await query('UPDATE suggestions SET stale_marked_at = NULL, stale_exempt = 1, updated_at = ? WHERE id = ?', [Date.now(), suggestion.id]);
        return interaction.update({ embeds: [embed], components: retainedRows });
      }

      const nextStatus = interaction.customId === 'suggestion_accept' ? 'accepted' : interaction.customId === 'suggestion_deny' ? 'denied' : 'considering';
      const embed = EmbedBuilder.from(interaction.message.embeds[0] || new EmbedBuilder());
      embed.setColor(nextStatus === 'accepted' ? 0x57F287 : nextStatus === 'denied' ? 0xED4245 : 0xFEE75C);
      const updatedFields = (embed.data.fields || []).map(field => field.name.toLowerCase() === 'status' ? { ...field, value: statusLabel(nextStatus) } : field);
      if (!updatedFields.some(field => field.name.toLowerCase() === 'status')) updatedFields.push({ name: 'Status', value: statusLabel(nextStatus), inline: true });
      embed.setFields(updatedFields);
      const retainedRows = interaction.message.components.filter(row => !row.components.some(component => component.customId === 'suggestion_remove_stale'));

      await query('UPDATE suggestions SET status = ?, updated_at = ?, stale_marked_at = NULL WHERE id = ?', [nextStatus, Date.now(), suggestion.id]);
      if (nextStatus === 'accepted' || nextStatus === 'denied') {
        if (suggestion.thread_id) {
          const thread = await interaction.guild.channels.fetch(suggestion.thread_id).catch(() => null);
          if (thread && typeof thread.setLocked === 'function') {
            await thread.setLocked(true).catch(() => null);
            await thread.setArchived(true).catch(() => null);
          }
        }
        await query('DELETE FROM suggestions WHERE id = ?', [suggestion.id]);
        return interaction.update({ embeds: [embed], components: [] });
      }
      return interaction.update({ embeds: [embed], components: retainedRows });
    }

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

      await interaction.deferUpdate();
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

      await interaction.editReply({
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


    if (interaction.customId.startsWith('bump_report:')) {
      const [, sourceGuildId] = interaction.customId.split(':');
      const modal = new ModalBuilder()
        .setCustomId(`bump_report_reason:${sourceGuildId}`)
        .setTitle('Report Server AD');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Why are you reporting this ad?')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(5)
            .setMaxLength(1000)
            .setRequired(true)
        )
      );

      await interaction.showModal(modal);
      const submit = await interaction.awaitModalSubmit({
        time: 10 * 60 * 1000,
        filter: m => m.customId === `bump_report_reason:${sourceGuildId}` && m.user.id === interaction.user.id
      }).catch(() => null);
      if (!submit) return;

      const reason = submit.fields.getTextInputValue('reason').trim();
      await submit.reply({ content: '✅ Thanks, this server was reported to the bot team.', flags: MessageFlags.Ephemeral }).catch(() => null);

      const sourceGuild = await interaction.client.guilds.fetch(sourceGuildId).catch(() => null);
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bump_report_action:blacklist:${sourceGuildId}`).setLabel('Blacklist Server').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bump_report_action:timeout:${sourceGuildId}`).setLabel('Timeout 30 Days').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bump_report_action:ignore:${sourceGuildId}`).setLabel('Ignore').setStyle(ButtonStyle.Success)
      );
      const reportEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚨 Bump AD Report')
        .addFields(
          { name: 'Reporter', value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: 'Reported from server', value: `${interaction.guild?.name || 'Unknown'} (${interaction.guildId || 'Unknown'})` },
          { name: 'Advertised server', value: `${sourceGuild?.name || 'Unknown'} (${sourceGuildId})` },
          { name: 'Reason', value: reason.slice(0, 1024) },
          { name: 'Exact message', value: String(interaction.message?.content || '(no message content)').slice(0, 1024) },
          { name: 'Jump URL', value: interaction.message?.url || 'Unavailable' }
        )
        .setTimestamp();

      if (BUMP_REPORT_CHANNEL_ID && BUMP_REPORT_CHANNEL_ID !== 'PASTE_BUMP_REPORT_CHANNEL_ID_HERE') {
        const reportChannel = await interaction.client.channels.fetch(BUMP_REPORT_CHANNEL_ID).catch(() => null);
        if (reportChannel?.isTextBased()) {
          await reportChannel.send({ embeds: [reportEmbed], components: [actionRow] }).catch(() => null);
          return;
        }
      }

      const app = await interaction.client.application.fetch().catch(() => null);
      const owner = app?.owner;
      const teamOwnerId = owner?.members?.find?.(member => member?.membershipState === 2)?.id;
      const ownerId = owner?.id || owner?.ownerId || teamOwnerId || process.env.BOT_OWNER_ID;
      if (!ownerId) return;

      const ownerUser = await interaction.client.users.fetch(ownerId).catch(() => null);
      if (!ownerUser) return;
      await ownerUser.send({ embeds: [reportEmbed] }).catch(() => null);
      return;
    }

    if (interaction.customId.startsWith('bump_report_action:')) {
      const [, action, sourceGuildId] = interaction.customId.split(':');
      if (!await isBotOwnerInteraction(interaction)) {
        return interaction.reply({ content: '❌ Only the bot owner can use these report actions.', flags: MessageFlags.Ephemeral });
      }

      if (action === 'blacklist') {
        await query(
          `REPLACE INTO blacklist (guild_id, added_at)
           VALUES (?, ?)`,
          [sourceGuildId, Date.now()]
        );
        await query('DELETE FROM bumping_configs WHERE guild_id = ?', [sourceGuildId]);
        await query('DELETE FROM bumping_restrictions WHERE guild_id = ?', [sourceGuildId]);
        return interaction.update({ content: `✅ Blacklisted guild ${sourceGuildId} from the bot.`, components: [] });
      }

      if (action === 'timeout') {
        const timeoutUntil = Date.now() + (30 * 24 * 60 * 60 * 1000);
        await query(
          `REPLACE INTO bumping_restrictions (guild_id, timeout_until, reason, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [sourceGuildId, timeoutUntil, 'Bump report action', interaction.user.id, Date.now()]
        );
        return interaction.update({ content: `✅ Applied 30-day bump timeout to guild ${sourceGuildId} (until <t:${Math.floor(timeoutUntil / 1000)}:F>).`, components: [] });
      }

      if (action === 'ignore') {
        return interaction.update({ content: `✅ Ignored report for guild ${sourceGuildId}.`, components: [] });
      }
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

async function isBotOwnerInteraction(interaction) {
  const app = await interaction.client.application.fetch().catch(() => null);
  const owner = app?.owner;
  const ownerId = owner?.id || owner?.ownerId || process.env.BOT_OWNER_ID;
  if (!ownerId) return false;

  if (interaction.user.id === ownerId) return true;
  const teamMemberIds = owner?.members?.map?.(member => member?.id).filter(Boolean) || [];
  return teamMemberIds.includes(interaction.user.id);
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

  const maxOpenTickets = await getPremiumLimit(interaction.client, interaction.guildId, 55, Number.POSITIVE_INFINITY);
  if (Number.isFinite(maxOpenTickets)) {
    const guildOpenRows = await query(
      `SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ?`,
      [interaction.guildId]
    );
    const guildOpenCount = Number(guildOpenRows[0]?.total || 0);
    if (guildOpenCount >= maxOpenTickets) {
      return interaction.reply({
        content: `❌ This server already has ${guildOpenCount}/${maxOpenTickets} open tickets. Free servers can have up to ${maxOpenTickets} open tickets at once.`,
        flags: MessageFlags.Ephemeral
      });
    }
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
    const lockKey = `${interaction.guildId}:${interaction.user.id}:${typeId}`;
    if (ticketCreateLocks.has(lockKey)) {
      return interaction.reply({ content: '⏳ Your ticket is already being created. Please wait a moment.', flags: MessageFlags.Ephemeral });
    }

    ticketCreateLocks.set(lockKey, Date.now());

    try {
      await interaction.update({ content: '⏳ Creating your ticket...', components: [] });

      const type = await getTicketTypeById(interaction.guildId, typeId);
      const settings = await getGuildTicketSettings(interaction.guildId);

      if (!type || !settings?.category_id) {
        return interaction.followUp({ content: '❌ Ticket setup is missing or invalid.', flags: MessageFlags.Ephemeral });
      }

    const maxOpenTickets = await getPremiumLimit(interaction.client, interaction.guildId, 55, Number.POSITIVE_INFINITY);
    if (Number.isFinite(maxOpenTickets)) {
      const guildOpenRows = await query(
        `SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ?`,
        [interaction.guildId]
      );
      const guildOpenCount = Number(guildOpenRows[0]?.total || 0);
      if (guildOpenCount >= maxOpenTickets) {
        return interaction.followUp({
          content: `❌ This server already has ${guildOpenCount}/${maxOpenTickets} open tickets. Free servers can have up to ${maxOpenTickets} open tickets at once.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    const category = await ensureTicketCategory(interaction.guild, settings.category_id);
    if (!category) {
      return interaction.followUp({ content: '❌ The configured ticket category is missing. Ask staff to run `/ticket config` again.', flags: MessageFlags.Ephemeral });
    }

    const maxTickets = Math.min(5, Math.max(1, Number(settings.max_tickets_per_user || 1)));
    const openRows = await query(
      `SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND user_id = ?`,
      [interaction.guildId, interaction.user.id]
    );
    const openCount = Number(openRows[0]?.total || 0);
    if (openCount >= maxTickets) {
      return interaction.followUp({ content: `❌ You already have ${openCount}/${maxTickets} open tickets.`, flags: MessageFlags.Ephemeral });
    }

    const existingSameTypeRows = await query(
      `SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND type_id = ? LIMIT 1`,
      [interaction.guildId, interaction.user.id, type.id]
    );
    if (existingSameTypeRows.length) {
      return interaction.followUp({ content: `ℹ️ You already have this ticket type open: <#${existingSameTypeRows[0].channel_id}>`, flags: MessageFlags.Ephemeral });
    }

    const staffRoleIds = parseRoleIds(type.staff_role_ids);

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
      name: 'ticket-opening',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${interaction.user.tag} (${interaction.user.id})`
    }).catch(() => null);

    if (!channel) {
      return interaction.followUp({ content: '❌ Failed to create the ticket channel. Check bot permissions.', flags: MessageFlags.Ephemeral });
    }

    const now = Date.now();
    const displayTicketId = await allocateGuildTicketDisplayId(interaction.guildId);
    const insert = await query(
      `INSERT INTO tickets (guild_id, channel_id, user_id, type_id, display_id, created_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [interaction.guildId, channel.id, interaction.user.id, type.id, displayTicketId, now, now]
    );
    const ticketId = Number(insert.insertId);
    const controls = buildTicketControls(ticketId);
    const safePrefix = (type.prefix || type.name || 'ticket')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 8) || 'TICKET';
    const safeUser = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'user';
    const ticketName = `${safePrefix}-${displayTicketId}-${safeUser}`.slice(0, 100);
    await channel.setName(ticketName).catch(() => null);

    await query(
      `REPLACE INTO ticket_user_activity (guild_id, user_id, last_opened_at)
       VALUES (?, ?, ?)`,
      [interaction.guildId, interaction.user.id, now]
    );

    const staffMentions = staffRoleIds.map(id => `<@&${id}>`);
    const mentionContent = [interaction.user.id, ...staffRoleIds]
      .map(id => (id === interaction.user.id ? `<@${id}>` : `<@&${id}>`))
      .join(' ');
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(type.name)
      .setDescription(type.welcome_message)
      .addFields(
        { name: 'Category', value: type.name, inline: false },
        { name: 'User', value: interaction.user.username, inline: false }
      )
      .setTimestamp(new Date(now));

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(controls.claim).setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(controls.close).setLabel('Close').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(controls.closeReason).setLabel('Close With Reason').setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content: mentionContent,
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
          .setDescription(`Ticket #${displayTicketId} was created.`)
          .addFields(
            { name: 'Type', value: type.name, inline: true },
            { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Channel', value: `<#${channel.id}>`, inline: true }
          )
          .setTimestamp(new Date(now));

        const creationMessage = await transcriptsChannel.send({ embeds: [creationEmbed] }).catch(() => null);
        if (creationMessage && typeof creationMessage.startThread === 'function') {
          const thread = await creationMessage.startThread({
            name: `ticket-${displayTicketId}-${type.name}`.slice(0, 100),
            autoArchiveDuration: 10080
          }).catch(() => null);
          if (thread?.id && channel.isTextBased()) {
            const topicParts = (channel.topic || '').split(' | ').filter(Boolean).filter(part => !part.startsWith('transcript_thread_id:'));
            topicParts.push(`transcript_thread_id:${thread.id}`);
            await channel.setTopic(topicParts.join(' | ').slice(0, 1024)).catch(() => null);
          }
        }
      }
    }

    await refreshWorkloadPanel(interaction.guild);
    return interaction.followUp({ content: `✅ Your ticket has been created: ${channel}`, flags: MessageFlags.Ephemeral });
    } finally {
      ticketCreateLocks.delete(lockKey);
    }
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
    const isStaff = await checkPerms(interaction, { scope: 'staff' }) || staffRoles.some(roleId => interaction.member.roles.cache.has(roleId));
    if (!isStaff) {
      return interaction.reply({ content: '❌ Only ticket staff can claim tickets.', flags: MessageFlags.Ephemeral });
    }
    if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
      return interaction.reply({ content: '❌ This ticket has already been claimed by another staff member.', flags: MessageFlags.Ephemeral });
    }
    if (ticket.claimed_by === interaction.user.id) {
      return interaction.reply({ content: '❌ You already claimed this ticket.', flags: MessageFlags.Ephemeral });
    }

    await query('UPDATE tickets SET claimed_by = ? WHERE id = ?', [interaction.user.id, ticketId]);
    await setClaimButtonState(interaction.message, ticketId, true, `Claimed by ${interaction.user.username}`.slice(0, 80));
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Ticket claimed!')
      .setDescription(`Your ticket will be handled by ${interaction.user}`);
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.customId.startsWith('ticket_close_reason:')) {
    const ticketId = Number(interaction.customId.split(':')[1]);
    await interaction.reply({
      content: 'Please type the close reason in chat within **60 seconds**.',
      flags: MessageFlags.Ephemeral
    });

    const reasonMessage = await interaction.channel.awaitMessages({
      filter: msg => msg.author.id === interaction.user.id,
      max: 1,
      time: 60_000
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
    await query(
      `UPDATE ticket_automation_close_requests
       SET resolved = 1
       WHERE guild_id = ? AND ticket_id = ? AND resolved = 0`,
      [interaction.guildId, ticketId]
    ).catch(() => null);
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
  const isStaff = await checkPerms(interaction, { scope: 'staff' }) || parseRoleIds(ticket.staff_role_ids).some(roleId => interaction.member.roles.cache.has(roleId));
  if (!isOwner && !isStaff) {
    return interaction.reply({ content: '❌ You are not allowed to close this ticket.', flags: MessageFlags.Ephemeral });
  }

  const channel = interaction.guild.channels.cache.get(ticket.channel_id) || await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
  const settings = await getGuildTicketSettings(interaction.guildId);

  if (settings?.transcripts_channel_id) {
    const transcriptChannel = await interaction.guild.channels.fetch(settings.transcripts_channel_id).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      const closeEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('Ticket Closed')
        .setDescription(`Ticket #${ticket.display_id} has been closed.`)
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

  const responseText = `✅ Closed ticket #${ticket.display_id}${closeReason ? ` with reason: ${closeReason}` : '.'}`;
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: responseText, flags: MessageFlags.Ephemeral }).catch(() => null);
  } else {
    await interaction.reply({ content: responseText, flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  await query('DELETE FROM tickets WHERE id = ?', [ticketId]);
  if (channel) {
    await channel.delete(`Ticket closed by ${interaction.user.tag} (${interaction.user.id})`).catch(() => null);
  }

  await refreshWorkloadPanel(interaction.guild);
}

async function setClaimButtonState(message, ticketId, disabled, label) {
  if (!message?.components?.length) return;
  const claimCustomId = `ticket_claim:${ticketId}`;
  const updatedRows = message.components.map(row => new ActionRowBuilder().addComponents(
    row.components.map(component => {
      if (component.customId === claimCustomId) {
        return ButtonBuilder.from(component)
          .setDisabled(disabled)
          .setLabel(label || 'Claim')
          .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success);
      }
      return ButtonBuilder.from(component);
    })
  ));
  await message.edit({ components: updatedRows }).catch(() => null);
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
