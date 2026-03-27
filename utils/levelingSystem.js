const { query } = require('../database');

const LEVELUP_MESSAGE_PRESETS = {
  classic: {
    withRole: 'Congrats {user}, you reached level **{level}**! You now have the {role}!',
    withoutRole: 'Congrats {user}, you reached level **{level}**!'
  },
  hype: {
    withRole: 'Yoo {user}, you leveled up to level **{level}**!! You now have the {role}!',
    withoutRole: 'Yoo {user}, you leveled up to level **{level}**!!'
  },
  fantasy: {
    withRole: '{user} advanced to level **{level}** and unlocked {role}.',
    withoutRole: '{user} advanced to level **{level}**'
  },
  chill: {
    withRole: 'Nice one {user}, you are now level **{level}**! Reward unlocked: {role}.',
    withoutRole: 'Nice one {user}, you are now level **{level}**!'
  },
  gamer: {
    withRole: 'LEVEL UP {user} | **LEVEL {level}** | Reward: {role}',
    withoutRole: 'LEVEL UP {user} | **LEVEL {level}**'
  }
};
const DEFAULT_MESSAGE_PRESET_KEY = 'classic';
const DEFAULT_WITH_ROLE = LEVELUP_MESSAGE_PRESETS[DEFAULT_MESSAGE_PRESET_KEY].withRole;
const DEFAULT_WITHOUT_ROLE = LEVELUP_MESSAGE_PRESETS[DEFAULT_MESSAGE_PRESET_KEY].withoutRole;
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

function getLevelupMessagePreset(presetKey) {
  return LEVELUP_MESSAGE_PRESETS[presetKey] || LEVELUP_MESSAGE_PRESETS[DEFAULT_MESSAGE_PRESET_KEY];
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
    `SELECT guild_id, enabled, levelup_channel_id, difficulty, boost_role_ids, channel_mode, channel_ids,
            message_with_role, message_without_role
     FROM leveling_settings
     WHERE guild_id = ?
     LIMIT 1`,
    [guildId]
  );

  if (!rows.length) {
    const fallback = {
      enabled: false,
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
    enabled: Boolean(row.enabled),
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
  LEVELUP_MESSAGE_PRESETS,
  DEFAULT_MESSAGE_PRESET_KEY,
  DEFAULT_WITH_ROLE,
  DEFAULT_WITHOUT_ROLE,
  difficultyMultiplier,
  xpForNextLevel,
  clampMessage,
  getLevelupMessagePreset,
  renderLevelMessage,
  parseCsvIds,
  progressBar,
  getGuildLevelingSettings,
  invalidateGuildLevelingCache
};
