const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pool = require('../database');
const { BOT_OWNER_ID } = require('../utils/constants');

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Send a support message to the bot owner')
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Type of support request')
        .addChoices(
          { name: 'Feedback', value: 'feedback' },
          { name: 'Report Abuse', value: 'report_abuse' },
          { name: 'Bug Report', value: 'bug_report' }
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Your message to the owner')
        .setRequired(true)
        .setMaxLength(1800)
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: '<:warning:1496193692099285255> Please use this command from a server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const type = interaction.options.getString('type', true);
    const message = interaction.options.getString('message', true).trim();

    if (!message.length) {
      return interaction.reply({
        content: '<:warning:1496193692099285255> Message cannot be empty.',
        flags: MessageFlags.Ephemeral
      });
    }

    const now = Date.now();

    let lastRequest;

    try {
      const rows = await pool.query(
        `SELECT created_at
         FROM support_requests
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [interaction.user.id]
      );

      lastRequest = rows[0] || null;
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: '<:warning:1496193692099285255> Database error while checking cooldown.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (lastRequest) {
      const elapsed = now - Number(lastRequest.created_at);
      if (elapsed < COOLDOWN_MS) {
        const nextTime = Math.floor((Number(lastRequest.created_at) + COOLDOWN_MS) / 1000);
        return interaction.reply({
          content: `⏳ You can send another support request <t:${nextTime}:R> (7-day cooldown).`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    let insertId = null;

    try {
      const result = await pool.query(
        `INSERT INTO support_requests (user_id, guild_id, category, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [interaction.user.id, interaction.guildId, type, message, now]
      );

      insertId = result.insertId;
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: '<:warning:1496193692099285255> Database error while saving your request.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const owner = await interaction.client.users.fetch(BOT_OWNER_ID);
      const guildName = interaction.guild?.name || 'Unknown Guild';

      await owner.send(
        [
          '📩 **New Support Request**',
          `Request ID: \`${insertId}\``,
          `Type: **${type}**`,
          `From: ${interaction.user.tag} (\`${interaction.user.id}\`)`,
          `Guild: ${guildName} (\`${interaction.guildId}\`)`,
          '',
          message,
          '',
          `Reply with: \`/owner support_reply user:${interaction.user.id} message:<your response>\``
        ].join('\n')
      );
    } catch (err) {
      console.error(err);
      return interaction.reply({
        content: '⚠️ Saved your support request, but I could not DM the owner right now.',
        flags: MessageFlags.Ephemeral
      });
    }

    return interaction.reply({
      content: '<:checkmark:1495875811792781332> Your support request has been sent. You can submit again in 7 days.',
      flags: MessageFlags.Ephemeral
    });
  }
};
