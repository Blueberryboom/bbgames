const {
  SlashCommandBuilder,
  MessageFlags
} = require('discord.js');

const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { BOT_OWNER_ID } = require('../utils/constants');
const { getPremiumLimit } = require('../utils/premiumPerks');
const { trackAchievementEvent } = require('../utils/achievementManager');

const TAG_FREE_LIMIT = 25;
const TAG_PREMIUM_LIMIT = 200;

async function canUseTag(interaction, tag) {
  if (interaction.user.id === BOT_OWNER_ID) return true;
  if (await checkPerms(interaction)) return true;

  const mode = tag.send_mode || 'admins';
  if (mode === 'anyone') return true;
  if (mode !== 'roles') return false;

  const rows = await query(
    `SELECT role_id
     FROM tag_allowed_roles
     WHERE guild_id = ? AND tag_name = ?`,
    [interaction.guildId, tag.tag_name]
  );

  if (!rows.length) return false;
  return rows.some(row => interaction.member.roles.cache.has(row.role_id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Create and use reusable server tags')
    .addSubcommand(sub =>
      sub
        .setName('send')
        .setDescription('Send a saved tag')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Tag name')
            .setRequired(true)
            .setMaxLength(40)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create or update a tag (admin only)')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Tag name')
            .setRequired(true)
            .setMaxLength(40)
        )
        .addStringOption(option =>
          option
            .setName('content')
            .setDescription('Tag content')
            .setRequired(true)
            .setMaxLength(1800)
        )
        .addBooleanOption(option =>
          option
            .setName('expire')
            .setDescription('Delete the sent tag message after 30 seconds')
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('usable_by')
            .setDescription('Who can use this tag')
            .setRequired(false)
            .addChoices(
              { name: 'Admins/admin role/bot owner only', value: 'admins' },
              { name: 'Anyone', value: 'anyone' },
              { name: 'Specific roles', value: 'roles' }
            )
        )
        .addStringOption(option =>
          option
            .setName('allowed_roles')
            .setDescription('Role IDs separated by commas (only for usable_by=roles)')
            .setRequired(false)
            .setMaxLength(400)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      if (!await checkPerms(interaction)) {
        return interaction.reply({
          content: '❌ You need administrator or the configured bot manager role to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const rawName = interaction.options.getString('name', true).trim().toLowerCase();
      const content = interaction.options.getString('content', true).trim();
      const expire = interaction.options.getBoolean('expire') || false;
      const usableBy = interaction.options.getString('usable_by') || 'admins';
      const roleInput = interaction.options.getString('allowed_roles')?.trim() || '';

      if (!/^[a-z0-9-]{2,40}$/.test(rawName)) {
        return interaction.reply({
          content: '❌ Tag names must be 2-40 characters and use only lowercase letters, numbers, and dashes.',
          flags: MessageFlags.Ephemeral
        });
      }

      const limit = await getPremiumLimit(interaction.client, interaction.guildId, TAG_FREE_LIMIT, TAG_PREMIUM_LIMIT);
      const countRows = await query(
        `SELECT COUNT(*) AS total
         FROM tags
         WHERE guild_id = ?`,
        [interaction.guildId]
      );

      const existsRows = await query(
        `SELECT 1
         FROM tags
         WHERE guild_id = ? AND tag_name = ?
         LIMIT 1`,
        [interaction.guildId, rawName]
      );

      const exists = Boolean(existsRows.length);
      const totalTags = Number(countRows[0]?.total || 0);
      if (!exists && totalTags >= limit) {
        return interaction.reply({
          content: `❌ Tag limit reached for this server (${limit}).`,
          flags: MessageFlags.Ephemeral
        });
      }

      let roleIds = [];
      if (usableBy === 'roles') {
        roleIds = roleInput
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);

        if (!roleIds.length) {
          return interaction.reply({
            content: '❌ When `usable_by` is `Specific roles`, provide role IDs in `allowed_roles`.',
            flags: MessageFlags.Ephemeral
          });
        }

        for (const roleId of roleIds) {
          if (!interaction.guild.roles.cache.has(roleId)) {
            return interaction.reply({
              content: `❌ Invalid role ID: \`${roleId}\``,
              flags: MessageFlags.Ephemeral
            });
          }
        }
      }

      await query(
        `INSERT INTO tags
         (guild_id, tag_name, content, created_by, expires_after_seconds, send_mode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           content = VALUES(content),
           created_by = VALUES(created_by),
           expires_after_seconds = VALUES(expires_after_seconds),
           send_mode = VALUES(send_mode),
           updated_at = VALUES(updated_at)`,
        [interaction.guildId, rawName, content, interaction.user.id, expire ? 30 : 0, usableBy, Date.now()]
      );

      await query(
        `DELETE FROM tag_allowed_roles
         WHERE guild_id = ? AND tag_name = ?`,
        [interaction.guildId, rawName]
      );

      if (usableBy === 'roles') {
        for (const roleId of roleIds) {
          await query(
            `INSERT INTO tag_allowed_roles (guild_id, tag_name, role_id)
             VALUES (?, ?, ?)`,
            [interaction.guildId, rawName, roleId]
          );
        }
      }

      return interaction.reply({
        content: `✅ Saved tag \`${rawName}\` (${expire ? 'expires after 30s' : 'no expiry'}, usable by: ${usableBy}).`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rawName = interaction.options.getString('name', true).trim().toLowerCase();

    const rows = await query(
      `SELECT tag_name, content, expires_after_seconds, send_mode
       FROM tags
       WHERE guild_id = ? AND tag_name = ?
       LIMIT 1`,
      [interaction.guildId, rawName]
    );

    if (!rows.length) {
      return interaction.reply({
        content: '❌ That tag does not exist.',
        flags: MessageFlags.Ephemeral
      });
    }

    const tag = rows[0];
    if (!await canUseTag(interaction, tag)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this tag.',
        flags: MessageFlags.Ephemeral
      });
    }

    const now = Date.now();
    await query(
      `INSERT INTO tag_usage_stats (guild_id, tag_name, used_at)
       VALUES (?, ?, ?)`,
      [interaction.guildId, rawName, now]
    );

    await interaction.reply({ content: tag.content });

    await trackAchievementEvent({
      userId: interaction.user.id,
      event: 'tag_send',
      context: {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        channel: interaction.channel,
        userMention: `${interaction.user}`
      }
    });

    if (Number(tag.expires_after_seconds || 0) > 0) {
      setTimeout(() => {
        interaction.deleteReply().catch(() => null);
      }, Number(tag.expires_after_seconds) * 1000);
    }
  }
};
