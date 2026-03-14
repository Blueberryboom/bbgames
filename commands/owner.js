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
const BOT_OWNER = "1056523021894029372";

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
    ),

  async execute(interaction) {

    if (interaction.guild)
      return interaction.reply({ content: "❌ DM only.", ephemeral: true });

    if (interaction.user.id !== BOT_OWNER)
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

    // ======================================================
    // ================= SERVERS ============================
    // ======================================================

    if (sub === "servers") {

      await interaction.deferReply({ ephemeral: true });

      let guilds = [];

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
      const totalPages = Math.ceil(guilds.length / perPage);
      let page = 0;

      const buildEmbed = () => {
        const slice = guilds.slice(page * perPage, (page + 1) * perPage);

        return new EmbedBuilder()
          .setTitle(`🌍 Total Servers: ${guilds.length}`)
          .setDescription(
            slice.map(g =>
              `${g.premium ? '💎 ' : ''}**${g.name}**\nMembers: ${g.members} | ID: \`${g.id}\``
            ).join("\n\n")
          )
          .setFooter({ text: `Page ${page + 1} / ${totalPages}` });
      };

      const buildComponents = () => {

        const slice = guilds.slice(page * perPage, (page + 1) * perPage);

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_server')
          .setPlaceholder('Generate invite for server')
          .addOptions(
            slice.map(g => ({
              label: g.name.substring(0, 100),
              description: `${g.premium ? 'Premium • ' : ''}Members: ${g.members}`,
              value: g.id
            }))
          );

        const navRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('back')
            .setLabel('⬅')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('➡')
            .setStyle(ButtonStyle.Secondary)
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

        if (i.user.id !== BOT_OWNER)
          return i.reply({ content: "Not for you.", ephemeral: true });

        if (i.customId === "next") {
          page = (page + 1) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "back") {
          page = (page - 1 + totalPages) % totalPages;
          return i.update({ embeds: [buildEmbed()], components: buildComponents() });
        }

        if (i.customId === "select_server") {

          const guildId = i.values[0];
          let inviteUrl = null;

          try {
            const results = await interaction.client.shard.broadcastEval(
              async (client, { guildId }) => {

                const guild = client.guilds.cache.get(guildId);
                if (!guild) return null;

                const channel = guild.channels.cache
                  .filter(c =>
                    c.isTextBased() &&
                    c.permissionsFor(guild.members.me)
                      ?.has("CreateInstantInvite")
                  )
                  .first();

                if (!channel) return null;

                try {
                  const invite = await channel.createInvite({ maxAge: 300 });
                  return invite.url;
                } catch {
                  return null;
                }

              },
              { context: { guildId } }
            );

            inviteUrl = results.find(Boolean);

          } catch (err) {
            console.error(err);
          }

          if (!inviteUrl)
            return i.reply({
              content: "❌ Cannot create invite for that server.",
              ephemeral: true
            });

          return i.reply({ content: inviteUrl, ephemeral: true });
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

        if (i.user.id !== BOT_OWNER)
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
