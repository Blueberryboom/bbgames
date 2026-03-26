const { query } = require('../database');

const DEFAULT_WITH_ROLE = 'Level {level}. You unlocked {role}.';
const DEFAULT_WITHOUT_ROLE = 'Level {level}. Keep going.';
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
const settingsCache = new Map();

function difficultyMultiplier(difficulty = 3) {
  const value = Number(difficulty) || 3;
  return Math.max(1, Math.min(5, value));
}

function xpForNextLevel(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  return 120 + safeLevel * 35;
}

function clampMessage(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 160);
}

function renderLevelMessage(template, data) {
  return template
    .replaceAll('{user}', data.userMention)
    .replaceAll('{level}', String(data.level))
    .replaceAll('{role}', data.roleMention || 'no role');
}

function parseCsvIds(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const found = raw.match(/\d{16,20}/g) || [];
  return [...new Set(found)];
}

function progressBar(current, target, size = 18) {
  const safeTarget = Math.max(1, target);
  const ratio = Math.max(0, Math.min(1, current / safeTarget));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

async function getGuildLevelingSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const rows = await query(
    `SELECT guild_id, levelup_channel_id, difficulty, boost_role_ids, channel_mode, channel_ids,
            message_with_role, message_without_role
     FROM leveling_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );

  if (!rows.length) {
    const fallback = {
      levelup_channel_id: null,
      difficulty: 3,
      boostRoleIds: [],
      channelMode: null,
      channelIds: [],
      message_with_role: DEFAULT_WITH_ROLE,
      message_without_role: DEFAULT_WITHOUT_ROLE
    };
    settingsCache.set(guildId, { value: fallback, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
    return fallback;
  }

  const row = rows[0];
  const normalized = {
    ...row,
    boostRoleIds: parseCsvIds(row.boost_role_ids),
    channelMode: row.channel_mode || null,
    channelIds: parseCsvIds(row.channel_ids),
    message_with_role: clampMessage(row.message_with_role, DEFAULT_WITH_ROLE),
    message_without_role: clampMessage(row.message_without_role, DEFAULT_WITHOUT_ROLE)
  };
  settingsCache.set(guildId, { value: normalized, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  return normalized;
}

function invalidateGuildLevelingCache(guildId) {
  if (!guildId) return;
  settingsCache.delete(guildId);
}

module.exports = {
  DEFAULT_WITH_ROLE,
  DEFAULT_WITHOUT_ROLE,
  difficultyMultiplier,
  xpForNextLevel,
  clampMessage,
  renderLevelMessage,
  parseCsvIds,
  progressBar,
  getGuildLevelingSettings,
  invalidateGuildLevelingCache
};
