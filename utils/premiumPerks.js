const { query } = require('../database');

const cache = new Map();
const CACHE_TTL_MS = 30 * 1000;

function invalidatePremiumGuildCache(guildId) {
  if (guildId) {
    cache.delete(guildId);
    return;
  }
  cache.clear();
}

async function hasRedeemedGuildPremium(guildId) {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await query(
    `SELECT 1
     FROM premium_guild_perks
     WHERE guild_id = ?
       AND active = 1
     LIMIT 1`,
    [guildId]
  );

  const value = rows.length > 0;
  cache.set(guildId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function guildHasPremiumPerks(client, guildId) {
  if (client?.isPremiumInstance) return true;
  return hasRedeemedGuildPremium(guildId);
}

async function getPremiumLimit(client, guildId, freeLimit, premiumLimit) {
  const premium = await guildHasPremiumPerks(client, guildId);
  return premium ? premiumLimit : freeLimit;
}

module.exports = {
  guildHasPremiumPerks,
  getPremiumLimit,
  hasRedeemedGuildPremium,
  invalidatePremiumGuildCache
};
