const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { query } = require('../database');
const { getSuggestionSettings, parseRoleIds } = require('../utils/suggestionSystem');

async function createSuggestion(interaction, title, description, categoryName) {
  const settings = await getSuggestionSettings(interaction.guildId);
  if (!settings) {
    return interaction.reply({ content: '⚠️ Suggestions are not configured in this server yet. Ask staff to run `/suggestions config` first.', flags: MessageFlags.Ephemeral });
  }

  if (settings.disabled_until && Number(settings.disabled_until) > Date.now()) {
    return interaction.reply({ content: `⏸️ Suggestions are temporarily disabled until <t:${Math.floor(Number(settings.disabled_until) / 1000)}:F>.`, flags: MessageFlags.Ephemeral });
  }

  const blacklisted = await query('SELECT 1 FROM suggestion_blacklist WHERE guild_id = ? AND user_id = ? LIMIT 1', [interaction.guildId, interaction.user.id]);
  if (blacklisted.length) {
    return interaction.reply({ content: '⚠️ You are blacklisted from creating suggestions in this server.', flags: MessageFlags.Ephemeral });
  }

  const allowedRoles = parseRoleIds(settings.allowed_role_ids);
  if (allowedRoles.length && !allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId))) {
    return interaction.reply({ content: '⚠️ You do not have permission to create suggestions.', flags: MessageFlags.Ephemeral });
  }

  const cooldownMs = Math.max(0, Number(settings.cooldown_ms || 0));
  if (cooldownMs > 0) {
    const activityRows = await query('SELECT last_suggested_at FROM suggestion_user_activity WHERE guild_id = ? AND user_id = ? LIMIT 1', [interaction.guildId, interaction.user.id]);
    const lastAt = Number(activityRows[0]?.last_suggested_at || 0);
    const remaining = lastAt + cooldownMs - Date.now();
    if (remaining > 0) {
      return interaction.reply({ content: `⏳ You can create another suggestion <t:${Math.floor((Date.now() + remaining) / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
    }
  }

  const channel = await interaction.guild.channels.fetch(settings.channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    return interaction.reply({ content: '⚠️ The configured suggestions channel is missing or no longer text-based.', flags: MessageFlags.Ephemeral });
  }

  const embed = {
    color: 0xFEE75C,
    title,
    description,
    fields: [
      { name: 'Created by', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Type', value: categoryName || 'N/A', inline: true },
      { name: 'Status', value: 'N/A', inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, custom_id: 'suggestion_accept', label: 'Accept' },
      { type: 2, style: 4, custom_id: 'suggestion_deny', label: 'Deny' },
      { type: 2, style: 1, custom_id: 'suggestion_considering', label: 'Considering' }
    ]
  }];

  const pingContent = settings.ping_role_id ? `<@&${settings.ping_role_id}>` : null;
  const message = await channel.send({
    content: pingContent || undefined,
    allowedMentions: pingContent ? { parse: [], roles: [settings.ping_role_id] } : { parse: [] },
    embeds: [embed],
    components
  });
  await message.react('✅').catch(() => null);
  await message.react('⚠️').catch(() => null);

  let threadId = null;
  if (Number(settings.create_thread || 0) === 1 && typeof message.startThread === 'function') {
    const thread = await message.startThread({ name: `suggestion-${message.id}`.slice(0, 100), autoArchiveDuration: 10080 }).catch(() => null);
    threadId = thread?.id || null;
  }

  await query(
    `INSERT INTO suggestions
     (guild_id, channel_id, message_id, thread_id, author_id, title, description, category_name, status, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'na', ?, ?)`,
    [interaction.guildId, channel.id, message.id, threadId, interaction.user.id, title, description, categoryName || null, Date.now(), Date.now()]
  );

  await query('REPLACE INTO suggestion_user_activity (guild_id, user_id, last_suggested_at) VALUES (?, ?, ?)', [interaction.guildId, interaction.user.id, Date.now()]);

  return interaction.reply({ content: `✅ Suggestion posted in ${channel}.`, flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Create a server suggestion')
    .addStringOption(opt => opt.setName('title').setDescription('Suggestion title').setRequired(true).setMaxLength(120))
    .addStringOption(opt => opt.setName('suggestion').setDescription('Suggestion details').setRequired(true).setMaxLength(2000))
    .addStringOption(opt => opt
      .setName('category')
      .setDescription('Optional category')
      .setRequired(false)
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'category') return interaction.respond([]);

    const term = String(focused.value || '').trim();
    const rows = await query('SELECT name FROM suggestion_categories WHERE guild_id = ? ORDER BY name ASC LIMIT 100', [interaction.guildId]);
    const filtered = rows
      .map(row => row.name)
      .filter(name => !term || name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, 25)
      .map(name => ({ name, value: name }));

    return interaction.respond(filtered);
  },

  async execute(interaction) {
    const title = interaction.options.getString('title', true).trim();
    const description = interaction.options.getString('suggestion', true).trim();
    const category = interaction.options.getString('category')?.trim() || null;

    if (category) {
      const rows = await query('SELECT 1 FROM suggestion_categories WHERE guild_id = ? AND name = ? LIMIT 1', [interaction.guildId, category]);
      if (!rows.length) {
        return interaction.reply({ content: '⚠️ That category does not exist. Ask staff to create it with `/suggestions create_category`.', flags: MessageFlags.Ephemeral });
      }
    }

    return createSuggestion(interaction, title, description, category);
  },

  createSuggestion
};
