const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { query } = require('../database');
const checkPerms = require('../utils/checkEventPerms');

const BLOCKED_WORDS = ['gay', 'lesbian', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'slut', 'whore', 'fuck', 'shit', 'bitch', 'cunt'];

function hasBlockedText(text) {
  const lower = text.toLowerCase();
  if (/(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(lower)) return true;
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
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable bumping and remove related data')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (!await checkPerms(interaction)) {
      return interaction.reply({ content: '❌ You need administrator or configured bot manager role.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      const everyonePerms = channel.permissionsFor(interaction.guild.roles.everyone);
      if (!everyonePerms?.has('ViewChannel')) {
        return interaction.reply({ content: '❌ @everyone must be able to view the bumping channel.', flags: MessageFlags.Ephemeral });
      }

      await query(
        `INSERT INTO bumping_configs (guild_id, channel_id, enabled, updated_by, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), enabled = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
        [interaction.guildId, channel.id, interaction.user.id, Date.now()]
      );

      return interaction.reply({ content: `✅ Bumping channel set to ${channel}. Next: run \/bumping advertisement to configure your ad.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'disable') {
      await query('DELETE FROM bumping_configs WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM bumping_usage WHERE guild_id = ?', [interaction.guildId]);
      await query('DELETE FROM bumping_channel_usage WHERE guild_id = ?', [interaction.guildId]);
      return interaction.reply({ content: '✅ Bumping module disabled and data removed.', flags: MessageFlags.Ephemeral });
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
      return submit.reply({ content: '❌ Advertisement contains blocked content (links/offensive text).', flags: MessageFlags.Ephemeral });
    }

    await query(
      `INSERT INTO bumping_configs (guild_id, advertisement, enabled, updated_by, updated_at)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE advertisement = VALUES(advertisement), enabled = 1, updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [interaction.guildId, ad, interaction.user.id, Date.now()]
    );

    return submit.reply({ content: '✅ Advertisement saved. Now use /bump to distribute your server ad.', flags: MessageFlags.Ephemeral });
  }
};
