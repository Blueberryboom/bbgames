const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder
} = require('discord.js');

const pool = require('../database');
const { BOT_OWNER_ID } = require('../utils/constants');
const { invalidatePremiumGuildCache } = require('../utils/premiumPerks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Global owner control panel')

    .addSubcommand(s =>
      s.setName('servers')
       .setDescription('View all servers')
    )

    .addSubcommand(s =>
      s.setName('blacklists')
       .setDescription('View blacklisted servers')
    )

    .addSubcommand(s =>
      s.setName('announce')
       .setDescription('Send announcement to all counting channels')
       .addStringOption(o =>
         o.setName('message')
          .setDescription('Message')
          .setRequired(true)
       )
       .addBooleanOption(o =>
         o.setName('force')
          .setDescription('Send even when system announcements are disabled')
          .setRequired(false)
       )
    )


    .addSubcommand(s =>
      s.setName('support_reply')
       .setDescription('Reply to a support request user via DM')
       .addStringOption(o =>
         o.setName('user')
          .setDescription('User ID')
          .setRequired(true)
       )
       .addStringOption(o =>
         o.setName('message')
          .setDescription('Reply message to send')
          .setRequired(true)
       )
    )

    .addSubcommand(s =>
      s.setName('moderate')
       .setDescription('Leave or blacklist a server')
       .addStringOption(o =>
         o.setName('guild')
          .setDescription('Guild ID')
          .setRequired(true)
       )
       .addStringOption(o =>
         o.setName('action')
          .setDescription('Action')
          .addChoices(
            { name: 'Leave', value: 'leave' },
            { name: 'Blacklist', value: 'blacklist' }
          )
          .setRequired(true)
       )
    )

    .addSubcommand(s =>
      s.setName('premium_access')
       .setDescription('Manage premium allowlist users')
       .addStringOption(o =>
         o.setName('action')
          .setDescription('Action')
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List', value: 'list' }
          )
          .setRequired(true)
       )
       .addStringOption(o =>
         o.setName('user')
          .setDescription('User ID (required for add/remove)')
          .setRequired(false)
       )
    )

    .addSubcommand(s =>
      s.setName('premium_codes')
       .setDescription('Create, delete, and list premium redeem codes')
       .addStringOption(o =>
         o.setName('action')
          .setDescription('Action')
          .addChoices(
            { name: 'Create', value: 'create' },
            { name: 'Delete', value: 'delete' },
            { name: 'List', value: 'list' }
          )
          .setRequired(true)
       )
       .addStringOption(o =>
         o.setName('code')
          .setDescription('Code value (required for create/delete)')
          .setRequired(false)
       )
       .addStringOption(o =>
         o.setName('length')
          .setDescription('License length (required for create)')
          .addChoices(
            { name: 'One Month', value: '1_month' },
            { name: 'One Year', value: '1_year' },
           { name: 'Lifetime', value: 'lifetime' }
          )
          .setRequired(false)
       )
    )

    .addSubcommand(s =>
      s.setName('approve_data_deletion')
       .setDescription('Allow a server administrator to run /config delete_data for a large server')
       .addStringOption(o =>
         o.setName('guild')
          .setDescription('Guild ID to approve')
          .setRequired(true)
       )
    ),

  async execute(interaction) {

    if (interaction.guild)
      return interaction.reply({ content: "❌ DM only.", ephemeral: true });

    if (interaction.user.id !== BOT_OWNER_ID)
      return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === 'premium_access') {
      const action = interaction.options.getString('action', true);
      const userId = interaction.options.getString('user', false)?.trim();

      if (action !== 'list' && (!userId || !/^\d{17,20}$/.test(userId))) {
        return interaction.reply({
          content: '❌ Please provide a valid Discord user ID for add/remove.',
          ephemeral: true
        });
      }

      if (action === 'add') {
        await pool.query(
          `REPLACE INTO premium_allowed_users (user_id, added_at, source, expires_at, notified_at)
           VALUES (?, ?, 'manual', NULL, NULL)`,
          [userId, Date.now()]
        );

        return interaction.reply({
          content: `✅ Added \`${userId}\` to premium allowlist.`,
          ephemeral: true
        });
      }

      if (action === 'remove') {
        await pool.query(
          `DELETE FROM premium_allowed_users
           WHERE user_id = ?`,
          [userId]
        );

        return interaction.reply({
          content: `✅ Removed \`${userId}\` from premium allowlist.`,
          ephemeral: true
        });
      }

      const rows = await pool.query(
        `SELECT user_id, added_at, source, expires_at
         FROM premium_allowed_users
         ORDER BY added_at DESC
         LIMIT 50`
      );

      if (!rows.length) {
        return interaction.reply({
          content: 'ℹ️ Premium allowlist is empty.',
          ephemeral: true
        });
      }

      const description = rows
        .map(r => {
          const source = r.source || 'manual';
          const expiryText = Number(r.expires_at) > Date.now()
            ? ` • expires <t:${Math.floor(Number(r.expires_at) / 1000)}:R>`
            : '';

          return `• \`${r.user_id}\` (${source}) <t:${Math.floor(Number(r.added_at) / 1000)}:R>${expiryText}`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('💎 Premium Allowlist')
        .setDescription(description);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }


    if (sub === 'premium_codes') {
      const action = interaction.options.getString('action', true);
      const codeInput = interaction.options.getString('code', false)?.trim();
      const length = interaction.options.getString('length', false);

      if ((action === 'create' || action === 'delete') && (!codeInput || codeInput.length < 4 || codeInput.length > 64)) {
        return interaction.reply({
          content: '❌ Please provide a valid code between 4 and 64 characters.',
          ephemeral: true
        });
      }

      if (action === 'create') {
        if (!length) {
          return interaction.reply({ content: '❌ Please provide a license length.', ephemeral: true });
        }

        const existing = await pool.query(
          `SELECT code, deleted_at
           FROM premium_codes
           WHERE code = ?
           LIMIT 1`,
          [codeInput]
        );

        if (existing.length && Number(existing[0].deleted_at) === 0) {
          return interaction.reply({ content: '❌ That premium code already exists.', ephemeral: true });
        }

        if (existing.length) {
          await pool.query(
            `UPDATE premium_codes
             SET duration_type = ?,
                 created_by = ?,
                 created_at = ?,
                 deleted_at = NULL,
                 redeemed_by_user_id = NULL,
                 redeemed_guild_id = NULL,
                 redeemed_at = NULL,
                 expires_at = NULL
             WHERE code = ?`,
            [length, interaction.user.id, Date.now(), codeInput]
          );
        } else {
          await pool.query(
            `INSERT INTO premium_codes
             (code, duration_type, created_by, created_at)
             VALUES (?, ?, ?, ?)`,
            [codeInput, length, interaction.user.id, Date.now()]
          );
        }

        return interaction.reply({
          content: `✅ Premium code \`${codeInput}\` created with duration \`${length}\`.`,
          ephemeral: true
        });
      }

      if (action === 'delete') {
        const codeRows = await pool.query(
          `SELECT redeemed_guild_id
           FROM premium_codes
           WHERE code = ?
           LIMIT 1`,
          [codeInput]
        );

        if (!codeRows.length) {
          return interaction.reply({
            content: '❌ That premium code does not exist.',
            ephemeral: true
          });
        }

        const redeemedGuildId = codeRows[0].redeemed_guild_id || null;
        if (redeemedGuildId) {
          await pool.query(
            `UPDATE premium_guild_perks
             SET active = 0,
                 updated_at = ?
             WHERE guild_id = ?
               AND code = ?
               AND source_type = 'code'
               AND active = 1`,
            [Date.now(), redeemedGuildId, codeInput]
          );
          invalidatePremiumGuildCache(redeemedGuildId);
        }

        await pool.query(
          `UPDATE premium_codes
           SET deleted_at = ?
           WHERE code = ?`,
          [Date.now(), codeInput]
        );

        return interaction.reply({
          content: `✅ Premium code \`${codeInput}\` deleted.`,
          ephemeral: true
        });
      }

      const rows = await pool.query(
        `SELECT code, duration_type, deleted_at, redeemed_by_user_id, redeemed_guild_id, redeemed_at, expires_at
         FROM premium_codes
         ORDER BY created_at DESC
         LIMIT 100`
      );

      if (!rows.length) {
        return interaction.reply({ content: 'ℹ️ No premium codes exist yet.', ephemeral: true });
      }

      const description = rows.map(row => {
        const state = Number(row.deleted_at) > 0 ? 'deleted' : row.redeemed_by_user_id ? 'redeemed' : 'active';
        const redeemedText = row.redeemed_by_user_id
          ? ` • user: \`${row.redeemed_by_user_id}\` • guild: \`${row.redeemed_guild_id || '-'}\``
          : '';
        const expiryText = Number(row.expires_at) > 0
          ? ` • expires <t:${Math.floor(Number(row.expires_at) / 1000)}:R>`
          : row.duration_type === 'lifetime' ? ' • lifetime' : '';
        const redeemedAt = Number(row.redeemed_at) > 0 ? ` • redeemed <t:${Math.floor(Number(row.redeemed_at) / 1000)}:R>` : '';

        return `• \`${row.code}\` (${row.duration_type}, ${state})${redeemedText}${redeemedAt}${expiryText}`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🎟️ Premium Codes')
        .setDescription(description);

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'approve_data_deletion') {
      const guildId = interaction.options.getString('guild', true).trim();
      if (!/^\d{17,20}$/.test(guildId)) {
        return interaction.reply({
          content: '❌ Please provide a valid Discord server ID.',
          ephemeral: true
        });
      }

      await pool.query(
        `REPLACE INTO guild_data_deletion_approvals (guild_id, approved_by, approved_at)
         VALUES (?, ?, ?)`,
        [guildId, interaction.user.id, Date.now()]
      );

      return interaction.reply({
        content: `✅ Approved data deletion for server \`${guildId}\`. An administrator there can now run \`/config delete_data\`.`,
        ephemeral: true
      });
    }

    // ======================================================
    // ================= SERVERS ============================
    // ======================================================

    if (sub === "servers") {

      await interaction.deferReply({ ephemeral: true });

      let guilds = [];
      const redeemedRows = await pool.query(
        `SELECT guild_id
         FROM premium_guild_perks
         WHERE active = 1`
      );
      const redeemedSet = new Set(redeemedRows.map(row => row.guild_id));

      try {
        const results = await interaction.client.shard.broadcastEval(
          client => {
            const normalGuilds = client.guilds.cache.map(g => ({
              name: g.name,
              id: g.id,
              members: g.memberCount,
              premium: false
            }));

            const premiumGuilds = client.premiumManager?.getPremiumGuildsSnapshot
              ? client.premiumManager.getPremiumGuildsSnapshot()
              : [];

            return [...premiumGuilds, ...normalGuilds];
          }
        );

        const seen = new Set();
        guilds = results
          .flat()
          .filter(g => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          })
          .map(g => ({
            ...g,
            premium: Boolean(g.premium) || redeemedSet.has(g.id)
          }))
          .sort((a, b) => {
            if (Boolean(b.premium) !== Boolean(a.premium)) {
              return Number(Boolean(b.premium)) - Number(Boolean(a.premium));
            }
            return (b.members || 0) - (a.members || 0);
          });

      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Failed to fetch guilds.");
      }

      if (!guilds.length)
        return interaction.editReply("Bot is not in any servers.");

      const perPage = 10;
      let page = 0;

      const buildEmbed = () => {
        const slice = guilds.slice(page * perPage, (page + 1) * perPage);
        const totalPages = Math.max(1, Math.ceil(guilds.length / perPage));

        return new EmbedBuilder()
          .setTitle(`🌍 Total Servers: ${guilds.length}`)
          .setDescription(
            slice.map(g =>
              `**${g.premium ? '💎 ' : ''}${g.name}**\nMembers: ${g.members} | ID: \`${g.id}\``
            ).join("\n\n")
          )
          .setFooter({ text: `Page ${page + 1} / ${totalPages}` });
      };

      const buildComponents = () => {

        const slice = guilds.slice(page * perPage, (page + 1) * perPage);

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_server')
          .setPlaceholder('Select server for details')
          .addOptions(
            slice.map(g => ({
              label: `${g.premium ? '💎 ' : ''}${g.name}`.substring(0, 100),
              description: `${g.premium ? 'Premium • ' : ''}Members: ${g.members}`,
              value: g.id
            }))
          );

        const navRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('back')
            .setLabel('⬅')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(guilds.length <= perPage),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('➡')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(guilds.length <= perPage)
        );

        return [
          new ActionRowBuilder().addComponents(select),
          navRow
        ];
      };

      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: buildComponents()
      });

      const collector = msg.createMessageComponentCollector({ time: 120000 });

      collector.on('collect', async i => {

        if (i.user.id !== BOT_OWNER_ID)
          return i.reply({ content: "Not for you.", ephemeral: true });

        if (i.customId === "next") {
          const totalPages = Math.max(1, Math.ceil(guilds.length / perPage));
          page = (page + 1) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "back") {
          const totalPages = Math.max(1, Math.ceil(guilds.length / perPage));
          page = (page - 1 + totalPages) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "select_server") {
          const guildId = i.values[0];
          const detail = await buildServerDetail(interaction.client, guildId);
          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`owner_server_leave:${guildId}`)
              .setLabel('Leave')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`owner_server_blacklist:${guildId}`)
              .setLabel('Blacklist')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`owner_server_invite:${guildId}`)
              .setLabel('Generate Invite')
              .setStyle(ButtonStyle.Primary)
          );

          return i.reply({ embeds: [detail], components: [actionRow], ephemeral: true });
        }
        
        if (i.customId.startsWith('owner_server_invite:')) {
           const guildId = i.customId.split(':')[1];
           const inviteUrl = await generateGuildInvite(interaction.client, guildId);
           if (!inviteUrl) {
              return i.reply({ content: '❌ Cannot create invite for that server.', ephemeral: true });
           }
           return i.reply({ content: `🔗 ${inviteUrl}\n(Valid for 7 days)`, ephemeral: true });
        }
        
          const detailEmbed = EmbedBuilder.from(i.message.embeds[0] || new EmbedBuilder());
          const fields = [...(detailEmbed.data.fields || [])];
          const inviteFieldIndex = fields.findIndex(field => field.name === 'Quick Invite');
          const inviteLine = `🔗 ${invite.url}\nExpires: <t:${Math.floor(invite.expiresAt / 1000)}:R>\nUses: **1** (auto-invalid after first join)`;
          if (inviteFieldIndex === -1) {
            fields.push({ name: 'Quick Invite', value: inviteLine, inline: false });
          } else {
            fields[inviteFieldIndex] = { ...fields[inviteFieldIndex], value: inviteLine };
          }
          detailEmbed.setFields(fields);
          detailEmbed.setFooter({ text: 'Invite is single-use and will stop working after one join.' });

          return i.update({ embeds: [detailEmbed], components: i.message.components });
        }

        if (i.customId.startsWith('owner_server_leave:')) {
          const guildId = i.customId.split(':')[1];
          const left = await leaveGuildById(interaction.client, guildId);
          if (!left) {
            return i.reply({ content: '❌ Could not leave that server.', ephemeral: true });
          }

          guilds = guilds.filter(g => g.id !== guildId);
          if (!guilds.length) {
            return i.update({ content: 'No servers remaining.', embeds: [], components: [] });
          }

          page = Math.min(page, Math.ceil(guilds.length / perPage) - 1);
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId.startsWith('owner_server_blacklist:')) {
          const guildId = i.customId.split(':')[1];
          try {
            await pool.query(
              `REPLACE INTO blacklist (guild_id, added_at)
               VALUES (?, ?)`,
              [guildId, Date.now()]
            );
          } catch (err) {
            console.error(err);
            return i.reply({ content: '❌ Failed to blacklist server.', ephemeral: true });
          }

          await leaveGuildById(interaction.client, guildId);
          guilds = guilds.filter(g => g.id !== guildId);
          if (!guilds.length) {
            return i.update({ content: 'No servers remaining.', embeds: [], components: [] });
          }

          page = Math.min(page, Math.ceil(guilds.length / perPage) - 1);
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }
      });

      return;
    }

    // ======================================================
    // ================= BLACKLIST VIEW =====================
    // ======================================================

    if (sub === "blacklists") {

      await interaction.deferReply({ ephemeral: true });

      let rows;

      try {
        rows = await pool.query("SELECT guild_id, added_at FROM blacklist");
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Database error.");
      }

      if (!rows.length)
        return interaction.editReply("✅ No blacklisted servers.");

      const perPage = 10;
      const totalPages = Math.ceil(rows.length / perPage);
      let page = 0;

      const buildEmbed = () => {
        const slice = rows.slice(page * perPage, (page + 1) * perPage);

        return new EmbedBuilder()
          .setTitle(`🚫 Blacklisted Servers (${rows.length})`)
          .setDescription(
            slice.map(r =>
              `ID: \`${r.guild_id}\`\nAdded: <t:${Math.floor(r.added_at/1000)}:R>`
            ).join("\n\n")
          )
          .setFooter({ text: `Page ${page + 1} / ${totalPages}` });
      };

      const buildComponents = () => {

        const slice = rows.slice(page * perPage, (page + 1) * perPage);

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_blacklist')
          .setPlaceholder('Unblacklist server')
          .addOptions(
            slice.map(r => ({
              label: r.guild_id,
              description: "Remove from blacklist",
              value: r.guild_id
            }))
          );

        const navRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('back').setLabel('⬅').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('next').setLabel('➡').setStyle(ButtonStyle.Secondary)
        );

        return [
          new ActionRowBuilder().addComponents(select),
          navRow
        ];
      };

      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: buildComponents()
      });

      const collector = msg.createMessageComponentCollector({ time: 120000 });

      collector.on('collect', async i => {

        if (i.user.id !== BOT_OWNER_ID)
          return i.reply({ content: "Not for you.", ephemeral: true });

        if (i.customId === "next") {
          page = (page + 1) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "back") {
          page = (page - 1 + totalPages) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "select_blacklist") {

          const guildId = i.values[0];

          try {
            await pool.query("DELETE FROM blacklist WHERE guild_id = ?", [guildId]);
          } catch (err) {
            console.error(err);
            return i.reply({ content: "❌ Failed to unblacklist.", ephemeral: true });
          }

          rows = rows.filter(r => r.guild_id !== guildId);

          if (!rows.length)
            return i.update({ content: "✅ Blacklist empty.", embeds: [], components: [] });

          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }
      });

      return;
    }

    // ======================================================
    // ================= ANNOUNCE ===========================
    // ======================================================

    if (sub === "announce") {

      const messageText = interaction.options.getString("message");
      const force = interaction.options.getBoolean("force") ?? false;

      await interaction.deferReply({ ephemeral: true });

      let rows;

      try {
        rows = await pool.query(
          `SELECT guild_id, channel_id
           FROM counting
           WHERE channel_id IS NOT NULL
             AND (? = 1 OR announcements_enabled = 1)`,
          [force ? 1 : 0]
        );
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Database error.");
      }

      let totalSent = 0;

      try {
        if (interaction.client.shard) {
          const results = await interaction.client.shard.broadcastEval(
            async (client, { rows, messageText }) => {

              let sent = 0;

              for (const row of rows) {
                const guild = client.guilds.cache.get(row.guild_id);
                if (!guild) continue;

                const channel = guild.channels.cache.get(row.channel_id);
                if (!channel || !channel.isTextBased()) continue;

                try {
                  await channel.send(`📢 **Announcement:**
${messageText}`);
                  sent++;
                } catch {}
              }

              return sent;
            },
            { context: { rows, messageText } }
          );

          totalSent += results.reduce((a, b) => a + b, 0);

          const premiumResults = await interaction.client.shard.broadcastEval(
            (client, { rows, messageText }) =>
              client.premiumManager?.sendAnnouncementToCountingChannels
                ? client.premiumManager.sendAnnouncementToCountingChannels(rows, messageText)
                : 0,
            { context: { rows, messageText } }
          );

          totalSent += premiumResults.reduce((a, b) => a + b, 0);
        } else {
          for (const row of rows) {
            const guild = interaction.client.guilds.cache.get(row.guild_id);
            if (!guild) continue;

            const channel = guild.channels.cache.get(row.channel_id);
            if (!channel || !channel.isTextBased()) continue;

            try {
              await channel.send(`📢 **Announcement:**
${messageText}`);
              totalSent++;
            } catch {}
          }

          if (interaction.client.premiumManager?.sendAnnouncementToCountingChannels) {
            totalSent += await interaction.client.premiumManager.sendAnnouncementToCountingChannels(rows, messageText);
          }
        }
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Shard error.");
      }

      return interaction.editReply(`✅ Sent to ${totalSent} counting channels${force ? " (forced)." : "."}`);
    }



    // ======================================================
    // ================= SUPPORT REPLY ======================
    // ======================================================

    if (sub === "support_reply") {

      const userId = interaction.options.getString("user", true);
      const replyText = interaction.options.getString("message", true);

      await interaction.deferReply({ ephemeral: true });

      let request;

      try {
        const rows = await pool.query(
          `SELECT id
           FROM support_requests
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId]
        );

        request = rows[0] || null;
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Database error.");
      }

      if (!request)
        return interaction.editReply("❌ No support request found for that user ID.");

      let user;

      try {
        user = await interaction.client.users.fetch(userId);
      } catch {
        return interaction.editReply("❌ Could not fetch that user.");
      }

      try {
        await user.send(`📬 **Support Response**\n${replyText}`);
      } catch {
        return interaction.editReply("❌ Could not DM that user (their DMs may be closed).");
      }

      try {
        await pool.query(
          `UPDATE support_requests
           SET owner_reply = ?, replied_at = ?
           WHERE id = ?`,
          [replyText, Date.now(), request.id]
        );
      } catch (err) {
        console.error(err);
      }

      return interaction.editReply(`✅ Sent support reply to ${user.tag} (\`${user.id}\`).`);
    }

    // ======================================================
    // ================= MODERATE ===========================
    // ======================================================

    if (sub === "moderate") {

      const guildId = interaction.options.getString("guild");
      const action = interaction.options.getString("action");

      await interaction.deferReply({ ephemeral: true });

      if (action === "blacklist") {
        try {
          await pool.query(
            "INSERT IGNORE INTO blacklist (guild_id, added_at) VALUES (?, ?)",
            [guildId, Date.now()]
          );
        } catch (err) {
          console.error(err);
          return interaction.editReply("❌ DB error.");
        }
      }

      let left = false;

      try {
        const results = await interaction.client.shard.broadcastEval(
          async (client, { guildId }) => {

            const guild = client.guilds.cache.get(guildId);
            if (!guild) return false;

            await guild.leave().catch(() => {});
            return true;
          },
          { context: { guildId } }
        );

        left = results.some(Boolean);

      } catch (err) {
        console.error(err);
      }

      if (!left && action === "leave")
        return interaction.editReply("❌ Guild not found.");

      return interaction.editReply("✅ Action complete.");
    }
  }
};

async function generateGuildInvite(client, guildId) {
  const sevenDaysSeconds = 7 * 24 * 60 * 60;
  try {
    if (!client.shard) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return null;
      const channel = guild.channels.cache
        .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('CreateInstantInvite'))
        .first();
      if (!channel) return null;
      const invite = await channel.createInvite({
        maxAge: sevenDaysSeconds,
        maxUses: 1,
        unique: true,
        reason: 'Owner panel temporary single-use invite'
      }).catch(() => null);
      if (!invite?.url) return null;
      return {
        url: invite.url,
        expiresAt: Date.now() + (sevenDaysSeconds * 1000)
      };
    }

    const results = await client.shard.broadcastEval(
      async (botClient, { guildId }) => {
        const guild = botClient.guilds.cache.get(guildId);
        if (!guild) return null;

        const channel = guild.channels.cache
          .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('CreateInstantInvite'))
          .first();
        if (!channel) return null;

        try {
          const invite = await channel.createInvite({
            maxAge: 7 * 24 * 60 * 60,
            maxUses: 1,
            unique: true,
            reason: 'Owner panel temporary single-use invite'
          });
          if (!invite?.url) return null;
          return {
            url: invite.url,
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
          };
        } catch {
          return null;
        }
      },
      { context: { guildId } }
    );

    return results.find(result => result?.url) || null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function leaveGuildById(client, guildId) {
  try {
    if (!client.shard) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return false;
      await guild.leave().catch(() => null);
      return true;
    }

    const results = await client.shard.broadcastEval(
      async (botClient, { guildId }) => {
        const guild = botClient.guilds.cache.get(guildId);
        if (!guild) return false;
        await guild.leave().catch(() => null);
        return true;
      },
      { context: { guildId } }
    );
    return results.some(Boolean);
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function buildServerDetail(client, guildId) {
  const [premiumRows, countingRows, levelingRows, welcomeRows, stickyRows, autoRows, youtubeRows, giveawayRows, adminRoleRows, giveawayAdminRoleRows, staffRoleRows, ticketSettingsRows, ticketTypeRows, ticketOpenRows, variableSlowmodeRows, suggestionSettingsRows, suggestionOpenRows, minecraftRows] = await Promise.all([
    pool.query(
      `SELECT owner_user_id, source_user_id, source_type, code, active, expires_at
       FROM premium_guild_perks
       WHERE guild_id = ?
       LIMIT 1`,
      [guildId]
    ),
    pool.query(`SELECT channel_id, current, announcements_enabled FROM counting WHERE guild_id = ? LIMIT 1`, [guildId]),
    pool.query(`SELECT enabled, levelup_channel_id, difficulty, channel_mode, channel_ids FROM leveling_settings WHERE guild_id = ? LIMIT 1`, [guildId]),
    pool.query(`SELECT channel_id, message_key, image_enabled FROM welcome_settings WHERE guild_id = ? LIMIT 1`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM sticky_messages WHERE guild_id = ? AND enabled = 1`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM auto_messages WHERE guild_id = ? AND enabled = 1`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM youtube_subscriptions WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM giveaways WHERE guild_id = ? AND ended = 0`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM admin_roles WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM giveaway_admin_roles WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM staff_roles WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT category_id, claiming_enabled FROM ticket_settings WHERE guild_id = ? LIMIT 1`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM ticket_types WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM variable_slowmode_configs WHERE guild_id = ? AND enabled = 1`, [guildId]),
    pool.query(`SELECT channel_id, create_thread, cooldown_ms, disabled_until FROM suggestion_settings WHERE guild_id = ? LIMIT 1`, [guildId]),
    pool.query(`SELECT COUNT(*) AS total FROM suggestions WHERE guild_id = ?`, [guildId]),
    pool.query(`SELECT server_ip, display_ip, display_player_count, display_max_players, display_player_record, current_players, max_players, player_record, last_online, last_checked_at FROM minecraft_monitors WHERE guild_id = ? LIMIT 1`, [guildId])
  ]);

  const premium = premiumRows[0] || null;
  const counting = countingRows[0] || null;
  const leveling = levelingRows[0] || null;
  const welcome = welcomeRows[0] || null;
  const ticketSettings = ticketSettingsRows[0] || null;
  const suggestionsSettings = suggestionSettingsRows[0] || null;
  const minecraft = minecraftRows[0] || null;

  const moduleSummary = [
    `Counting: ${counting ? 'enabled' : 'disabled'}`,
    `Leveling: ${leveling?.enabled ? 'enabled' : 'disabled'}`,
    `Welcome: ${welcome ? 'enabled' : 'disabled'}`,
    `Sticky: ${Number(stickyRows[0]?.total || 0)} active`,
    `Auto Messages: ${Number(autoRows[0]?.total || 0)} active`,
    `YouTube: ${Number(youtubeRows[0]?.total || 0)} channels`,
    `Giveaways: ${Number(giveawayRows[0]?.total || 0)} running`,
    `Tickets: ${ticketSettings ? 'configured' : 'disabled'} • ${Number(ticketOpenRows[0]?.total || 0)} open`,
    `Variable Slowmode: ${Number(variableSlowmodeRows[0]?.total || 0)} active`,
    `Suggestions: ${suggestionsSettings ? 'configured' : 'disabled'} • ${Number(suggestionOpenRows[0]?.total || 0)} open`,
    `Minecraft Monitor: ${minecraft ? 'enabled' : 'disabled'}`
  ];

  const configSummary = [
    counting ? `Counting channel: <#${counting.channel_id}> • current \`${counting.current}\`` : 'Counting channel: not set',
    counting ? `Announcements: ${counting.announcements_enabled ? 'on' : 'off'}` : 'Announcements: n/a',
    leveling ? `Leveling channel: ${leveling.levelup_channel_id ? `<#${leveling.levelup_channel_id}>` : 'current channel'} • difficulty ${leveling.difficulty}` : 'Leveling settings: not configured',
    leveling?.channel_mode ? `Leveling channel filter: ${leveling.channel_mode}` : 'Leveling channel filter: none',
    welcome ? `Welcome channel: <#${welcome.channel_id}> • template: \`${welcome.message_key}\`` : 'Welcome settings: not configured',
    ticketSettings ? `Ticket category: <#${ticketSettings.category_id}> • claiming: ${ticketSettings.claiming_enabled ? 'on' : 'off'} • types: ${Number(ticketTypeRows[0]?.total || 0)}` : 'Ticket settings: not configured',
    suggestionsSettings ? `Suggestions channel: <#${suggestionsSettings.channel_id}> • thread: ${suggestionsSettings.create_thread ? 'on' : 'off'} • cooldown: ${Math.floor(Number(suggestionsSettings.cooldown_ms || 0) / 60000)}m` : 'Suggestions settings: not configured',
    minecraft
      ? `Minecraft monitor: \`${minecraft.server_ip}\` • players: ${Number(minecraft.current_players || 0)}/${Number(minecraft.max_players || 0)} • record: ${Number(minecraft.player_record || 0)} • online: ${Number(minecraft.last_online) ? 'yes' : 'no'}`
      : 'Minecraft monitor: not configured',
    minecraft
      ? `Minecraft display options: IP ${Number(minecraft.display_ip) ? 'on' : 'off'} • count ${Number(minecraft.display_player_count) ? 'on' : 'off'} • max ${Number(minecraft.display_max_players) ? 'on' : 'off'} • record ${Number(minecraft.display_player_record) ? 'on' : 'off'}`
      : 'Minecraft display options: n/a',
    `Admin roles: ${Number(adminRoleRows[0]?.total || 0)} • Giveaway admin roles: ${Number(giveawayAdminRoleRows[0]?.total || 0)} • Staff roles: ${Number(staffRoleRows[0]?.total || 0)}`
  ];

  const premiumText = premium
    ? `Yes (${premium.source_type || 'role'})${premium.code ? ` • code: \`${premium.code}\`` : ''}`
    : 'No';

  return new EmbedBuilder()
    .setTitle(`Server Details • ${guildId}`)
    .setColor(premium ? 0x9B59B6 : 0x5865F2)
    .addFields(
      { name: 'Premium', value: premiumText, inline: false },
      { name: 'Premium Owner / Source', value: premium ? `owner: \`${premium.owner_user_id}\`\nsource: \`${premium.source_user_id}\`` : 'n/a', inline: false },
      { name: 'Modules', value: moduleSummary.join('\n'), inline: false },
      { name: 'Configuration', value: configSummary.join('\n').slice(0, 1024), inline: false },
      { name: 'Quick Invite', value: 'Click **Generate Invite** to create a 7-day invite link.', inline: false }
    )
    .setFooter({ text: 'Use the buttons below for actions.' });
}
