const { query } = require('../database/index');
const {
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  EmbedBuilder
} = require('discord.js');
const youtubeSetupState = require('../utils/youtubeSetupState');
const welcomeSetupState = require('../utils/welcomeSetupState');
const rpsState = require('../utils/rpsState');
const { buildWelcomePayload } = require('../utils/welcomeSystem');
const { getPremiumLimit } = require('../utils/premiumPerks');
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
    value: 'Commands: `/coinflip`, `/dadjoke`, `/tictactoe`, `/rps`.'
  },
  youtube: {
    name: 'YouTube',
    value: 'Command: `/youtube` with add/remove/list for upload notifications.'
  },
  misc: {
    name: 'Misc',
    value: 'Commands: `/help`, `/about`, `/status`, `/support`, `/minecraft`, `/donate`, `/config`, `/sticky`, `/automsg`.'
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


    if (interaction.customId.startsWith('welcome_test_') || interaction.customId.startsWith('welcome_confirm_')) {
      const [, action, token] = interaction.customId.split('_');
      const pendingConfig = welcomeSetupState.get(token);

      if (!pendingConfig) {
        return interaction.reply({
          content: '❌ This welcome setup preview expired. Please run `/welcome` again.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (pendingConfig.userId !== interaction.user.id || pendingConfig.guildId !== interaction.guildId) {
        return interaction.reply({
          content: '❌ This setup preview belongs to a different user or server.',
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = await interaction.guild.channels.fetch(pendingConfig.channelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: '❌ The selected channel no longer exists.', flags: MessageFlags.Ephemeral });
      }

      const payload = buildWelcomePayload(interaction.member, interaction.guild, {
        message_key: pendingConfig.messageKey,
        button_label: pendingConfig.buttonLabel,
        button_url: pendingConfig.buttonUrl
      });

      if (action === 'test') {
        await channel.send(payload);

        return interaction.reply({ content: '✅ Test welcome message sent.', flags: MessageFlags.Ephemeral });
      }

      await query(
        `REPLACE INTO welcome_settings
         (guild_id, channel_id, message_key, button_label, button_url, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          pendingConfig.guildId,
          pendingConfig.channelId,
          pendingConfig.messageKey,
          pendingConfig.buttonLabel,
          pendingConfig.buttonUrl,
          interaction.user.id,
          Date.now()
        ]
      );

      welcomeSetupState.consume(token);

      return interaction.reply({
        content: `✅ Welcome system saved for <#${pendingConfig.channelId}>.`,
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
      return;
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
      const countRows = await query(
        `SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?`,
        [giveawayId]
      );

      const total = Number(countRows[0]?.total || 0);

      return replyToButton(
        interaction,
        `👥 **${total}** participant${total === 1 ? '' : 's'} entered this giveaway.`
      );
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
