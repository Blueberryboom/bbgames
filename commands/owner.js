const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');

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
      s.setName('announce')
       .setDescription('Send announcement to all counting channels')
       .addStringOption(o =>
         o.setName('message')
          .setDescription('Announcement message')
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

    // ─── DM ONLY ─────────────────────────────
    if (interaction.guild)
      return interaction.reply({ content: "❌ DM only.", ephemeral: true });

    if (interaction.user.id !== BOT_OWNER)
      return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    // ======================================================
    // ================== SERVERS VIEW ======================
    // ======================================================

    if (sub === "servers") {

      await interaction.deferReply({ ephemeral: true });

      // Get ALL guilds across shards
      const results = await interaction.client.shard.broadcastEval(client =>
        client.guilds.cache.map(g => ({
          name: g.name,
          id: g.id,
          members: g.memberCount
        }))
      );

      const guilds = results.flat();

      let page = 0;
      const perPage = 10;
      const totalPages = Math.ceil(guilds.length / perPage);

      const getEmbed = () => {
        const slice = guilds.slice(page * perPage, (page + 1) * perPage);

        return new EmbedBuilder()
          .setTitle(`🌍 Total Servers: ${guilds.length}`)
          .setDescription(
            slice.map(g =>
              `**${g.name}**\nMembers: ${g.members} | ID: \`${g.id}\``
            ).join("\n\n") || "No servers."
          )
          .setFooter({ text: `Page ${page + 1} / ${totalPages}` });
      };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('back')
          .setLabel('⬅')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('join')
          .setLabel('Join')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('➡')
          .setStyle(ButtonStyle.Secondary)
      );

      const msg = await interaction.editReply({
        embeds: [getEmbed()],
        components: [row]
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000
      });

      collector.on('collect', async i => {
        if (i.user.id !== BOT_OWNER)
          return i.reply({ content: "Not for you.", ephemeral: true });

        if (i.customId === "next") {
          page = (page + 1) % totalPages;
          await i.update({ embeds: [getEmbed()] });
        }

        if (i.customId === "back") {
          page = (page - 1 + totalPages) % totalPages;
          await i.update({ embeds: [getEmbed()] });
        }

        if (i.customId === "join") {
          const current = guilds[page * perPage];

          if (!current)
            return i.reply({ content: "No guild selected.", ephemeral: true });

          const invite = await interaction.client.shard.broadcastEval(
            async (client, { guildId }) => {
              const guild = client.guilds.cache.get(guildId);
              if (!guild) return null;

              const channel = guild.channels.cache
                .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"))
                .first();

              if (!channel) return null;

              try {
                const invite = await channel.createInvite({ maxAge: 300 });
                return invite.url;
              } catch {
                return null;
              }
            },
            { context: { guildId: current.id } }
          );

          const url = invite.find(Boolean);

          if (!url)
            return i.reply({ content: "❌ Cannot create invite.", ephemeral: true });

          await i.reply({ content: url, ephemeral: true });
        }
      });
    }

    // ======================================================
    // ================= GLOBAL ANNOUNCE ====================
    // ======================================================

    if (sub === "announce") {

      const messageText = interaction.options.getString("message");

      await interaction.deferReply({ ephemeral: true });

      const results = await interaction.client.shard.broadcastEval(
        async (client, { messageText }) => {

          const pool = require('../../database');

          const rows = await pool.query("SELECT * FROM counting");

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
        { context: { messageText } }
      );

      const total = results.reduce((a, b) => a + b, 0);

      await interaction.editReply(`✅ Sent to ${total} counting channels.`);
    }

    // ======================================================
    // ==================== MODERATE ========================
    // ======================================================

    if (sub === "moderate") {

      const guildId = interaction.options.getString("guild");
      const action = interaction.options.getString("action");

      await interaction.deferReply({ ephemeral: true });

      const result = await interaction.client.shard.broadcastEval(
        async (client, { guildId, action }) => {

          const guild = client.guilds.cache.get(guildId);
          if (!guild) return false;

          if (action === "leave") {
            await guild.leave();
            return true;
          }

          return false;

        },
        { context: { guildId, action } }
      );

      if (result.some(Boolean))
        return interaction.editReply("✅ Done.");

      interaction.editReply("❌ Guild not found.");
    }

  }
};
