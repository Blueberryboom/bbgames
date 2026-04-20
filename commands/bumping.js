const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

const BLOCKED_WORDS = ['gay', 'lesbian', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'slut', 'whore', 'fuck', 'shit', 'bitch', 'cunt'];
const REENABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function hasBlockedText(text) {
  const lower = text.toLowerCase();
  if (/(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(lower)) return true;
  if (/@everyone|@here|<@!?\d+>|<@&\d+>/.test(text)) return true;
  return BLOCKED_WORDS.some(word => lower.includes(word));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bumping')
    .setDescription('Configure server bumping module')
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set bumping channel')
        .addChannelOption(o => o.setName('channel').setDescription('Bumping destination channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    )
    .addSubcommand(sub => sub.setName('advertisement').setDescription('Configure server advertisement text'))
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable bumping and remove related data'))
    .addSubcommand(sub =>
      sub
        .setName('verification')
        .setDescription('Request BBGames bumping verification for your server')
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Why should this server be verified?')
            .setRequired(true)
            .setMaxLength(700)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ You need administrator or configured bot manager role.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'channel') {
      const existingRows = await query('SELECT disabled_at FROM bumping_configs WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
      const disabledAt = Number(existingRows[0]?.disabled_at || 0);
      const reenableAt = disabledAt + REENABLE_COOLDOWN_MS;
      if (disabledAt && reenableAt > Date.now()) {
        return interaction.reply({
          content: `❌ Bumping was recently disabled. You can enable it again <t:${Math.floor(reenableAt / 1000)}:R> (at <t:${Math.floor(reenableAt / 1000)}:F>).`,
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = interaction.options.getChannel('channel', true);
      const everyonePerms = channel.permissionsFor(interaction.guild.roles.everyone);
      if (!everyonePerms?.has('ViewChannel')) {
        return interaction.reply({ content: '❌ @everyone must be able to view the bumping channel.', flags: MessageFlags.Ephemeral });
      }

      await query(
        `INSERT INTO bumping_configs (guild_id, channel_id, enabled, updated_by, updated_at, disabled_at)
         VALUES (?, ?, 1, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), enabled = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at), disabled_at = NULL`,
        [interaction.guildId, channel.id, interaction.user.id, Date.now()]
      );

      return interaction.reply({ content: `✅ Bumping channel set to ${channel}. Next: run \/bumping advertisement to configure your ad.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable') {
      const now = Date.now();
      await query(
        `INSERT INTO bumping_configs (guild_id, enabled, updated_by, updated_at, disabled_at)
         VALUES (?, 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = 0, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at), disabled_at = VALUES(disabled_at)`,
        [interaction.guildId, interaction.user.id, now, now]
      );
      await query('DELETE FROM bumping_usage WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM bumping_channel_usage WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM bumping_restrictions WHERE guild_id = ?', [interaction.guildId]);
      return interaction.reply({
        content: `✅ Bumping module disabled and usage data removed. Re-enabling has a 1 day cooldown and will be available <t:${Math.floor((now + REENABLE_COOLDOWN_MS) / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'verification') {
      const usageRows = await query(
        'SELECT bump_count, verified_at, last_verification_request_at FROM bumping_usage WHERE guild_id = ? LIMIT 1',
        [interaction.guildId]
      );
      const usage = usageRows[0] || {};
      const bumpCount = Number(usage.bump_count || 0);
      const verifiedAt = Number(usage.verified_at || 0);
      const lastRequestAt = Number(usage.last_verification_request_at || 0);
      const cooldownMs = 60 * 24 * 60 * 60 * 1000;

      if (verifiedAt > 0) {
        return interaction.reply({
          content: `✅ This server is already verified (since <t:${Math.floor(verifiedAt / 1000)}:F>).`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (bumpCount < 50) {
        return interaction.reply({
          content: `❌ Verification requires at least **50** bumps. This server currently has **${bumpCount}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if ((interaction.guild?.memberCount || 0) < 100) {
        return interaction.reply({
          content: '❌ Verification requires at least **100** server members.',
          flags: MessageFlags.Ephemeral
        });
      }

      const requestAvailableAt = lastRequestAt + cooldownMs;
      if (lastRequestAt > 0 && requestAvailableAt > Date.now()) {
        return interaction.reply({
          content: `❌ You can send another verification request <t:${Math.floor(requestAvailableAt / 1000)}:R> (at <t:${Math.floor(requestAvailableAt / 1000)}:F>).`,
          flags: MessageFlags.Ephemeral
        });
      }

      const reason = interaction.options.getString('reason', true).trim();
      const now = Date.now();
      await query(
        `INSERT INTO bumping_usage (guild_id, last_verification_request_at, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_verification_request_at = VALUES(last_verification_request_at), updated_at = VALUES(updated_at)`,
        [interaction.guildId, now, now]
      );

      const reportChannelId = process.env.BUMP_REPORT_CHANNEL_ID || '1493358474174664885';
      const reportChannel = await interaction.client.channels.fetch(reportChannelId).catch(() => null);
      if (reportChannel?.isTextBased()) {
        await reportChannel.send({
          content: '📨 New bumping verification request',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`bump_verify_action:approve:${interaction.guildId}`).setLabel('Approve Verification').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`bump_verify_action:reject:${interaction.guildId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
            )
          ],
          embeds: [{
            color: 0x2ECC71,
            title: 'Verification Request',
            description: reason.slice(0, 1900),
            fields: [
              { name: 'Server', value: `${interaction.guild?.name || 'Unknown'} (${interaction.guildId})` },
              { name: 'Members', value: `${interaction.guild?.memberCount || 0}`, inline: true },
              { name: 'Bumps', value: `${bumpCount}`, inline: true },
              { name: 'Requested by', value: `${interaction.user.tag} (${interaction.user.id})` }
            ],
            timestamp: new Date().toISOString()
          }]
        }).catch(() => null);
      }

      return interaction.reply({
        content: '✅ Verification request sent to the BBGames team.',
        flags: MessageFlags.Ephemeral
      });
    }

    const existingRows = await query('SELECT disabled_at FROM bumping_configs WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const disabledAt = Number(existingRows[0]?.disabled_at || 0);
    const reenableAt = disabledAt + REENABLE_COOLDOWN_MS;
    if (disabledAt && reenableAt > Date.now()) {
      return interaction.reply({
        content: `❌ Bumping was recently disabled. You can enable it again <t:${Math.floor(reenableAt / 1000)}:R> (at <t:${Math.floor(reenableAt / 1000)}:F>).`,
        flags: MessageFlags.Ephemeral
      });
    }

    const modalId = `bumping_ad:${interaction.id}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('Configure Advertisement');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('ad').setLabel('Advertisement (max 10 lines, no links)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800)
    ));

    await interaction.showModal(modal);
    const submit = await interaction.awaitModalSubmit({
      time: 10 * 60 * 1000,
      filter: i => i.customId === modalId && i.user.id === interaction.user.id
    }).catch(() => null);
    if (!submit) return;

    const ad = submit.fields.getTextInputValue('ad').trim();
    if (ad.split('\n').length > 10) {
      return submit.reply({ content: '❌ Advertisement cannot exceed 10 lines.', flags: MessageFlags.Ephemeral });
    }
    if (hasBlockedText(ad)) {
      return submit.reply({ content: '❌ Advertisement contains blocked content (links, mentions, or offensive text).', flags: MessageFlags.Ephemeral });
    }

    await query(
      `INSERT INTO bumping_configs (guild_id, advertisement, enabled, updated_by, updated_at, disabled_at)
       VALUES (?, ?, 1, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE advertisement = VALUES(advertisement), enabled = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at), disabled_at = NULL`,
      [interaction.guildId, ad, interaction.user.id, Date.now()]
    );

    return submit.reply({ content: '✅ Advertisement saved. Now use /bump to distribute your server ad.', flags: MessageFlags.Ephemeral });
  }
};
