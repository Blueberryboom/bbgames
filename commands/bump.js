const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function sanitizeAdvertisement(adText) {
  return String(adText || '')
    .replace(/@everyone|@here/gi, '[mention removed]')
    .replace(/<@!?\d+>/g, '[user mention removed]')
    .replace(/<@&\d+>/g, '[role mention removed]')
    .trim();
}
const { query } = require('../database');
const { guildHasPremiumPerks } = require('../utils/premiumPerks');

const STANDARD_USER_BUMP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PREMIUM_USER_BUMP_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STANDARD_RECEIVE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PREMIUM_RECEIVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Set this to the channel ID where bump reports should be sent.
const BUMP_REPORT_CHANNEL_ID = '1493358474174664885';

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function ensureInvite(channel, existingCode) {
  if (existingCode) {
    const invite = await channel.client.fetchInvite(existingCode).catch(() => null);
    if (invite?.code) return invite;
  }
  const created = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'BBGames bumping invite' }).catch(() => null);
  return created;
}

module.exports = {
  BUMP_REPORT_CHANNEL_ID,
  data: new SlashCommandBuilder()
    .setName('bump')
    .setDescription('Bump your server advertisement to other BBGames servers'),

  async execute(interaction) {
    const guild = interaction.guild;
    const isPremium = await guildHasPremiumPerks(interaction.client, interaction.guildId);
    const restrictionRows = await query(
      'SELECT timeout_until FROM bumping_restrictions WHERE guild_id = ? LIMIT 1',
      [interaction.guildId]
    );
    const timeoutUntil = Number(restrictionRows[0]?.timeout_until || 0);
    if (timeoutUntil > Date.now()) {
      return interaction.reply({
        content: `❌ This server is temporarily blocked from bumping until <t:${Math.floor(timeoutUntil / 1000)}:F>.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const configRows = await query('SELECT * FROM bumping_configs WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const config = configRows[0];
    if (!config?.channel_id || !config?.advertisement || !Number(config?.enabled || 0)) {
      return interaction.reply({ content: '❌ Configure `/bumping channel` and `/bumping advertisement` first.', flags: MessageFlags.Ephemeral });
    }

    const configuredChannel = await guild.channels.fetch(config.channel_id).catch(() => null);
    if (!configuredChannel?.isTextBased()) {
      return interaction.reply({
        content: '❌ Your configured bumping channel no longer exists. Please set it again with `/bumping channel`.',
        flags: MessageFlags.Ephemeral
      });
    }

    const usageRows = await query('SELECT last_bump_at, joined_count, bump_count FROM bumping_usage WHERE guild_id = ? LIMIT 1', [interaction.guildId]);
    const isVerified = Number(usageRows[0]?.verified_at || 0) > 0;
    const last = Number(usageRows[0]?.last_bump_at || 0);
    const userCooldownMs = isPremium ? PREMIUM_USER_BUMP_COOLDOWN_MS : STANDARD_USER_BUMP_COOLDOWN_MS;
    const remaining = (last + userCooldownMs) - Date.now();
    if (remaining > 0) {
      return interaction.reply({ content: `⏳ You can bump again <t:${Math.floor((Date.now() + remaining) / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const sourceChannel = config?.channel_id ? await guild.channels.fetch(config.channel_id).catch(() => null) : null;
    const inviteChannel = sourceChannel?.isTextBased() ? sourceChannel : guild.systemChannel || guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(['CreateInstantInvite', 'SendMessages']));
    if (!inviteChannel) {
      return interaction.editReply('❌ Could not find a channel to create/reuse invite link.');
    }

    const invite = await ensureInvite(inviteChannel, config?.invite_code || null);
    if (!invite?.code) return interaction.editReply('❌ Failed to create/reuse invite link for bumping.');

    await query('UPDATE bumping_configs SET invite_code = ?, updated_at = ? WHERE guild_id = ?', [invite.code, Date.now(), interaction.guildId]);

    const eligibleRows = await query(
      `SELECT bc.guild_id, bc.channel_id
       FROM bumping_configs bc
       WHERE bc.enabled = 1
         AND bc.guild_id != ?
         AND bc.channel_id IS NOT NULL
         AND bc.advertisement IS NOT NULL`,
      [interaction.guildId]
    );

    const maxTargets = isVerified ? 75 : 50;
    const randomTargets = shuffle(eligibleRows).slice(0, maxTargets);

    const nextBumpNumber = Number(usageRows[0]?.bump_count || 0) + 1;
    const joinedCount = Number(usageRows[0]?.joined_count || 0);
    let posted = 0;
    for (const target of randomTargets) {
      const cooldownRows = await query('SELECT last_received_at FROM bumping_channel_usage WHERE guild_id = ? LIMIT 1', [target.guild_id]);
      const lastReceived = Number(cooldownRows[0]?.last_received_at || 0);
      const targetIsPremium = await guildHasPremiumPerks(interaction.client, target.guild_id);
      const receiveCooldownMs = targetIsPremium ? PREMIUM_RECEIVE_COOLDOWN_MS : STANDARD_RECEIVE_COOLDOWN_MS;
      if (lastReceived + receiveCooldownMs > Date.now()) continue;

      const targetGuild = interaction.client.guilds.cache.get(target.guild_id) || await interaction.client.guilds.fetch(target.guild_id).catch(() => null);
      if (!targetGuild) continue;

      const targetChannel = await targetGuild.channels.fetch(target.channel_id).catch(() => null);
      if (!targetChannel?.isTextBased()) continue;

      const sanitizedAd = sanitizeAdvertisement(config?.advertisement || 'A premium server bump.');
      const sent = await targetChannel.send({
        content: `${sanitizedAd}\n\nInvite: https://discord.gg/${invite.code}`,
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`AD from ${guild.name}`)
            .setDescription('Loading ad count...')
        ],
        allowedMentions: { parse: [] }
      }).catch(() => null);
      if (!sent) continue;

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Join server').setStyle(ButtonStyle.Link).setURL(`https://discord.gg/${invite.code}`),
        new ButtonBuilder().setCustomId(`bump_report:${guild.id}:${sent.id}`).setLabel('Report Server').setStyle(ButtonStyle.Danger),
        ...(isVerified ? [new ButtonBuilder().setCustomId('bump_verified_info').setLabel('Verified').setEmoji('<:checkmark:1495875811792781332>').setStyle(ButtonStyle.Success)] : []),
        ...(isPremium ? [new ButtonBuilder().setCustomId('bump_premium_info').setLabel('Premium Server').setEmoji('🔥').setStyle(ButtonStyle.Success)] : [])
      );
      await sent.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(isPremium ? 0xF39C12 : 0x5865F2)
            .setTitle(`<a:partyblob:1495854250297790725> AD from ${guild.name}`)
            .setDescription(`This is the **#${nextBumpNumber}** AD sent by this server, and **${joinedCount}** people have joined through this AD.`)
        ],
        components: [actionRow]
      }).catch(() => null);

      posted += 1;
      await query(
        `INSERT INTO bumping_channel_usage (guild_id, last_received_at, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_received_at = VALUES(last_received_at), updated_at = VALUES(updated_at)`,
        [target.guild_id, Date.now(), Date.now()]
      );
    }

    await query(
      `INSERT INTO bumping_usage (guild_id, last_bump_at, bump_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_bump_at = VALUES(last_bump_at),
         bump_count = bump_count + 1,
         updated_at = VALUES(updated_at)`,
      [interaction.guildId, Date.now(), 1, Date.now()]
    );

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🔥 Server Bumped')
      .setDescription(`The AD has been sent to **${posted}** other servers, and **${joinedCount}** people have joined through bumping so far.\nYou can bump again <t:${Math.floor((Date.now() + userCooldownMs) / 1000)}:R>!`);

    return interaction.editReply({ embeds: [embed] });
  }
};
