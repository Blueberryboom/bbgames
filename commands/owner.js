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
    ),

  async execute(interaction) {

    if (interaction.guild)
      return interaction.reply({ content: "❌ DM only.", ephemeral: true });

    if (interaction.user.id !== BOT_OWNER)
      return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    // ======================================================
    // ================= SERVERS ============================
    // ======================================================

    if (sub === "servers") {

      await interaction.deferReply({ ephemeral: true });

      let guilds = [];

      try {
        const results = await interaction.client.shard.broadcastEval(
          client => client.guilds.cache.map(g => ({
            name: g.name,
            id: g.id,
            members: g.memberCount
          }))
        );

        guilds = results.flat().sort((a, b) => b.members - a.members);

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
              `**${g.name}**\nMembers: ${g.members} | ID: \`${g.id}\``
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
              description: `Members: ${g.members}`,
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

      await interaction.deferReply({ ephemeral: true });

      let rows;

      try {
        rows = await pool.query("SELECT guild_id, channel_id FROM counting");
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Database error.");
      }

      let totalSent = 0;

      try {
        const results = await interaction.client.shard.broadcastEval(
          async (client, { rows, messageText }) => {

            let sent = 0;

            for (const row of rows) {

              const guild = client.guilds.cache.get(row.guild_id);
              if (!guild) continue;

              const channel = guild.channels.cache.get(row.channel_id);
              if (!channel || !channel.isTextBased()) continue;

              try {
                await channel.send(`📢 **Announcement:**\n${messageText}`);
                sent++;
              } catch {}
            }

            return sent;
          },
          { context: { rows, messageText } }
        );

        totalSent = results.reduce((a, b) => a + b, 0);

      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Shard error.");
      }

      return interaction.editReply(`✅ Sent to ${totalSent} counting channels.`);
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
