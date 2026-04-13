const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');
const { getPremiumLimit } = require('../utils/premiumPerks');
const { parseDhms } = require('../utils/duration');
const { invalidateGuild } = require('../utils/autoResponderManager');

const MAX_TRIGGERS = 10;
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;

function triggerButtons(includeFinish) {
  const buttons = [
    new ButtonBuilder().setCustomId('ar_trigger_wildcard').setLabel('Wildcard').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ar_trigger_strict').setLabel('Strict').setStyle(ButtonStyle.Secondary)
  ];
  if (includeFinish) buttons.push(new ButtonBuilder().setCustomId('ar_trigger_finish').setLabel('Finish').setStyle(ButtonStyle.Success));
  return new ActionRowBuilder().addComponents(buttons);
}

async function collectWord(interactionBase, buttonInteraction, mode) {
  const modalId = `ar_trigger_word:${interactionBase.id}:${Date.now()}`;
  const modal = new ModalBuilder().setCustomId(modalId).setTitle(`Add ${mode} trigger`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('word')
      .setLabel('Single trigger word (2-32 chars, no spaces)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32)
  ));

  await buttonInteraction.showModal(modal);
  const submit = await buttonInteraction.awaitModalSubmit({
    time: SETUP_TIMEOUT_MS,
    filter: modalSubmit => modalSubmit.customId === modalId && modalSubmit.user.id === interactionBase.user.id
  }).catch(() => null);

  if (!submit) return null;
  const word = submit.fields.getTextInputValue('word').trim().toLowerCase();
  if (!/^[^\s]{2,32}$/.test(word)) {
    await submit.reply({ content: '❌ Trigger must be a single word between 2 and 32 characters (no spaces).', flags: MessageFlags.Ephemeral });
    return false;
  }

  await submit.reply({ content: `✅ Added **${mode}** trigger: \`${word}\``, flags: MessageFlags.Ephemeral });
  return { mode, word };
}

async function collectResponse(interactionBase, promptMessage) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ar_response_plain').setLabel('Plaintext').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ar_response_embed').setLabel('Embed').setStyle(ButtonStyle.Secondary)
  );

  await promptMessage.edit({ content: 'Choose response type.', components: [row] });
  const button = await promptMessage.awaitMessageComponent({
    time: SETUP_TIMEOUT_MS,
    filter: i => i.user.id === interactionBase.user.id && ['ar_response_plain', 'ar_response_embed'].includes(i.customId)
  }).catch(() => null);
  if (!button) return null;

  if (button.customId === 'ar_response_plain') {
    const modalId = `ar_response_plain:${interactionBase.id}:${Date.now()}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('Plaintext response');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('content').setLabel('Message content').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)
    ));
    await button.showModal(modal);
    const submit = await button.awaitModalSubmit({
      time: SETUP_TIMEOUT_MS,
      filter: m => m.customId === modalId && m.user.id === interactionBase.user.id
    }).catch(() => null);
    if (!submit) return null;
    const content = submit.fields.getTextInputValue('content').trim();
    await submit.reply({ content: '✅ Plaintext response saved.', flags: MessageFlags.Ephemeral });
    return { responseType: 'plaintext', responsePayload: { content } };
  }

  const modalId = `ar_response_embed:${interactionBase.id}:${Date.now()}`;
  const modal = new ModalBuilder().setCustomId(modalId).setTitle('Embed response');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Color hex (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('#3498DB').setMaxLength(7)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048))
  );
  await button.showModal(modal);
  const submit = await button.awaitModalSubmit({
    time: SETUP_TIMEOUT_MS,
    filter: m => m.customId === modalId && m.user.id === interactionBase.user.id
  }).catch(() => null);
  if (!submit) return null;

  const colorInput = submit.fields.getTextInputValue('color')?.trim() || '#3498DB';
  const color = /^#[0-9a-fA-F]{6}$/.test(colorInput) ? colorInput : '#3498DB';
  const payload = {
    title: submit.fields.getTextInputValue('title')?.trim() || null,
    description: submit.fields.getTextInputValue('description').trim(),
    color,
    footer: submit.fields.getTextInputValue('footer')?.trim() || null
  };

  await submit.reply({ content: '✅ Embed response saved.', flags: MessageFlags.Ephemeral });
  return { responseType: 'embed', responsePayload: payload };
}

async function collectWhitelist(interactionBase, promptMessage) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ar_channels_all').setLabel('Allow in all channels').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ar_channels_whitelist').setLabel('Whitelist').setStyle(ButtonStyle.Secondary)
  );
  await promptMessage.edit({ content: 'Configure channel scope.', components: [row] });

  const button = await promptMessage.awaitMessageComponent({
    time: SETUP_TIMEOUT_MS,
    filter: i => i.user.id === interactionBase.user.id && ['ar_channels_all', 'ar_channels_whitelist'].includes(i.customId)
  }).catch(() => null);
  if (!button) return null;

  if (button.customId === 'ar_channels_all') {
    await button.update({ content: '✅ Auto responder will run in all channels.', components: [] });
    return null;
  }

  const modalId = `ar_channel_whitelist:${interactionBase.id}:${Date.now()}`;
  const modal = new ModalBuilder().setCustomId(modalId).setTitle('Whitelist channel IDs');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('ids').setLabel('Channel IDs separated by commas').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
  ));
  await button.showModal(modal);

  const submit = await button.awaitModalSubmit({
    time: SETUP_TIMEOUT_MS,
    filter: m => m.customId === modalId && m.user.id === interactionBase.user.id
  }).catch(() => null);
  if (!submit) return null;

  const ids = submit.fields.getTextInputValue('ids')
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d{5,}$/.test(id));

  const unique = [...new Set(ids)];
  const valid = unique.filter(id => submit.guild.channels.cache.has(id));
  if (!valid.length) {
    await submit.reply({ content: '❌ No valid channels from this server were provided.', flags: MessageFlags.Ephemeral });
    return false;
  }

  await submit.reply({ content: `✅ Whitelist set: ${valid.map(id => `<#${id}>`).join(', ')}`, flags: MessageFlags.Ephemeral });
  return valid;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto_responder')
    .setDescription('Create and manage auto responders')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new auto responder')
        .addStringOption(o => o.setName('name').setDescription('Responder name').setRequired(true).setMaxLength(64))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List configured auto responders'))
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edit an existing auto responder response')
        .addStringOption(o => o.setName('name').setDescription('Responder name').setRequired(true).setMaxLength(64))
    )
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete an auto responder')
        .addStringOption(o => o.setName('name').setDescription('Responder name').setRequired(true).setMaxLength(64))
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable a responder for some time')
        .addStringOption(o => o.setName('name').setDescription('Responder name').setRequired(true).setMaxLength(64))
        .addStringOption(o => o.setName('time').setDescription('Duration like 2d 3h 52m').setRequired(true).setMaxLength(40))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ You need administrator or the configured bot manager role.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const rows = await query('SELECT name, triggers_json, response_type, channel_whitelist_json, disabled_until FROM auto_responders WHERE guild_id = ? ORDER BY name ASC', [interaction.guildId]);
      if (!rows.length) {
        return interaction.reply({ content: 'ℹ️ No auto responders configured yet.', flags: MessageFlags.Ephemeral });
      }

      const lines = rows.map((row, i) => {
        const triggers = JSON.parse(row.triggers_json || '[]');
        const channelScope = row.channel_whitelist_json ? `${JSON.parse(row.channel_whitelist_json || '[]').length} whitelisted channel(s)` : 'All channels';
        const disabled = row.disabled_until && Number(row.disabled_until) > Date.now() ? `Disabled until <t:${Math.floor(Number(row.disabled_until) / 1000)}:R>` : 'Enabled';
        return `${i + 1}. **${row.name}** • ${triggers.length} trigger(s) • ${row.response_type} • ${channelScope} • ${disabled}`;
      });

      return interaction.reply({ content: lines.join('\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
    }


    if (sub === 'delete') {
      const name = interaction.options.getString('name', true).trim();
      const result = await query(
        `DELETE FROM auto_responders
         WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
        [interaction.guildId, name]
      );
      if (!result.affectedRows) {
        return interaction.reply({ content: `❌ Auto responder **${name}** not found.`, flags: MessageFlags.Ephemeral });
      }
      invalidateGuild(interaction.guildId);
      return interaction.reply({ content: `✅ Deleted auto responder **${name}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable') {
      const name = interaction.options.getString('name', true).trim();
      const ms = parseDhms(interaction.options.getString('time', true));
      if (!ms || ms <= 0) {
        return interaction.reply({ content: '❌ Invalid time format. Example: `2d 3h 52m`.', flags: MessageFlags.Ephemeral });
      }
      const until = Date.now() + ms;
      const result = await query(
        `UPDATE auto_responders
         SET disabled_until = ?, updated_at = ?
         WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
        [until, Date.now(), interaction.guildId, name]
      );
      if (!result.affectedRows) {
        return interaction.reply({ content: `❌ Auto responder **${name}** not found.`, flags: MessageFlags.Ephemeral });
      }
      invalidateGuild(interaction.guildId);
      return interaction.reply({ content: `✅ Disabled **${name}** until <t:${Math.floor(until / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'edit') {
      const name = interaction.options.getString('name', true).trim();
      const existingRows = await query('SELECT id FROM auto_responders WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [interaction.guildId, name]);
      const existing = existingRows[0];
      if (!existing) return interaction.reply({ content: `❌ Auto responder **${name}** not found.`, flags: MessageFlags.Ephemeral });

      await interaction.reply({ content: 'Let\'s update the response message.', flags: MessageFlags.Ephemeral });
      const prompt = await interaction.fetchReply();
      const response = await collectResponse(interaction, prompt);
      if (!response) {
        return interaction.editReply({ content: '⏱️ Edit timed out after 10 minutes.', components: [] });
      }

      await query(
        `UPDATE auto_responders
         SET response_type = ?, response_payload = ?, updated_at = ?
         WHERE id = ?`,
        [response.responseType, JSON.stringify(response.responsePayload), Date.now(), existing.id]
      );
      invalidateGuild(interaction.guildId);
      return interaction.editReply({ content: `✅ Updated response for **${name}**.`, components: [] });
    }

    const name = interaction.options.getString('name', true).trim();
    if (!/^[A-Za-z0-9 _-]{1,64}$/.test(name)) {
      return interaction.reply({ content: '❌ Name can only contain letters, numbers, spaces, `_` and `-`.', flags: MessageFlags.Ephemeral });
    }

    const dup = await query('SELECT id FROM auto_responders WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [interaction.guildId, name]);
    if (dup.length) return interaction.reply({ content: '❌ An auto responder with that name already exists.', flags: MessageFlags.Ephemeral });

    const countRows = await query('SELECT COUNT(*) AS total FROM auto_responders WHERE guild_id = ?', [interaction.guildId]);
    const limit = await getPremiumLimit(interaction.client, interaction.guildId, 4, 10);
    if (Number(countRows[0]?.total || 0) >= limit) {
      return interaction.reply({ content: `❌ You can only have ${limit} auto responders on this bot tier.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({ content: 'Configure trigger words. Add triggers, then click **Finish** when done (max 10).', components: [triggerButtons(true)], flags: MessageFlags.Ephemeral });
    const msg = await interaction.fetchReply();
    const triggers = [];

    while (triggers.length < MAX_TRIGGERS) {
      const button = await msg.awaitMessageComponent({
        time: SETUP_TIMEOUT_MS,
        filter: i => i.user.id === interaction.user.id && ['ar_trigger_wildcard', 'ar_trigger_strict', 'ar_trigger_finish'].includes(i.customId)
      }).catch(() => null);

      if (!button) {
        return interaction.editReply({ content: '⏱️ Auto responder setup expired after 10 minutes.', components: [] });
      }

      if (button.customId === 'ar_trigger_finish') {
        if (!triggers.length) {
          await button.reply({ content: '❌ Add at least one trigger before finishing.', flags: MessageFlags.Ephemeral }).catch(() => null);
          continue;
        }
        await button.update({ content: `✅ Trigger collection done (${triggers.length}).`, components: [] }).catch(() => null);
        break;
      }

      const mode = button.customId === 'ar_trigger_strict' ? 'strict' : 'wildcard';
      const created = await collectWord(interaction, button, mode);
      if (created === false) continue;
      if (!created) return interaction.editReply({ content: '⏱️ Auto responder setup expired after 10 minutes.', components: [] });

      if (!triggers.some(t => t.word === created.word && t.mode === created.mode)) triggers.push(created);
      if (triggers.length >= MAX_TRIGGERS) break;

      await msg.edit({ content: `Current triggers (${triggers.length}/${MAX_TRIGGERS}): ${triggers.map(t => `\`${t.mode}:${t.word}\``).join(', ') || 'none'}. Add another trigger or click **Finish**.`, components: [triggerButtons(true)] }).catch(() => null);
    }

    if (!triggers.length) {
      return interaction.editReply({ content: '❌ You must configure at least one trigger.', components: [] });
    }

    const response = await collectResponse(interaction, msg);
    if (!response) return interaction.editReply({ content: '⏱️ Auto responder setup expired after 10 minutes.', components: [] });

    const whitelist = await collectWhitelist(interaction, msg);
    if (whitelist === false) return interaction.editReply({ content: '❌ Invalid whitelist selection. Run setup again.', components: [] });

    await query(
      `INSERT INTO auto_responders
       (guild_id, name, triggers_json, response_type, response_payload, channel_whitelist_json, disabled_until, enabled, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
      [
        interaction.guildId,
        name,
        JSON.stringify(triggers),
        response.responseType,
        JSON.stringify(response.responsePayload),
        Array.isArray(whitelist) ? JSON.stringify(whitelist) : null,
        interaction.user.id,
        Date.now()
      ]
    );

    invalidateGuild(interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Auto responder created')
      .setDescription(`**${name}** is now active.`)
      .addFields(
        { name: 'Triggers', value: triggers.map(t => `• ${t.mode}: \`${t.word}\``).join('\n').slice(0, 1024) },
        { name: 'Channel scope', value: Array.isArray(whitelist) ? whitelist.map(id => `<#${id}>`).join(', ') : 'All channels' }
      );

    return interaction.editReply({ content: '', embeds: [embed], components: [] });
  }
};
