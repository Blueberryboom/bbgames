const { query } = require('../database');

let syncInterval = null;

function extractServerTag(guild) {
  const bracket = guild.name.match(/\[([^\]]{2,12})\]/);
  if (bracket) return bracket[1].trim().toLowerCase();

  const acronym = (guild.nameAcronym || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (acronym.length >= 2) return acronym;
  return null;
}

function memberHasServerTag(member, tag) {
  if (!tag) return false;
  const sources = [member.displayName, member.user?.globalName, member.user?.username]
    .filter(Boolean)
    .map(v => v.toLowerCase());

  return sources.some(text => text.includes(tag));
}

async function syncGuildServerTagRewards(guild) {
  const rows = await query(
    `SELECT role_id, enabled
     FROM servertag_reward_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guild.id]
  );

  const config = rows[0];
  if (!config || Number(config.enabled) !== 1) return;

  const role = guild.roles.cache.get(config.role_id) || await guild.roles.fetch(config.role_id).catch(() => null);
  if (!role) return;

  const tag = extractServerTag(guild);
  if (!tag) return;

  const members = await guild.members.fetch().catch(() => null);
  if (!members) return;

  for (const member of members.values()) {
    if (member.user.bot) continue;

    const shouldHave = memberHasServerTag(member, tag);
    const hasRole = member.roles.cache.has(role.id);

    if (shouldHave && !hasRole) {
      await member.roles.add(role, 'Server tag reward sync').catch(() => null);
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(role, 'Server tag reward sync').catch(() => null);
    }
  }
}

async function runServerTagSync(client) {
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    await syncGuildServerTagRewards(guild).catch(err => {
      console.error(`⚠️ Server tag reward sync failed for ${guild.id}:`, err?.message || err);
    });
  }
}

function initServerTagRewardManager(client) {
  if (syncInterval) clearInterval(syncInterval);

  // Run shortly after startup so configs are applied even before first interval tick.
  setTimeout(() => runServerTagSync(client).catch(() => null), 15_000).unref?.();

  syncInterval = setInterval(() => {
    runServerTagSync(client).catch(err => {
      console.error('⚠️ Server tag reward sync loop failed:', err);
    });
  }, 5 * 60 * 1000);

  syncInterval.unref?.();
}

module.exports = {
  initServerTagRewardManager,
  syncGuildServerTagRewards
};
