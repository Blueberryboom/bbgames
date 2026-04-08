const { query } = require('../database');
const checkPerms = require('./checkEventPerms');

function parseDuration(input) {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  const matches = [...value.matchAll(/(\d+)\s*([dhm])/g)];
  if (!matches.length) return null;

  let ms = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (unit === 'd') ms += amount * 24 * 60 * 60 * 1000;
    if (unit === 'h') ms += amount * 60 * 60 * 1000;
    if (unit === 'm') ms += amount * 60 * 1000;
  }

  const stripped = value.replace(/(\d+)\s*[dhm]/g, '').trim();
  if (stripped.length) return null;
  return ms;
}

function parseRoleIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(id => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

async function canManageSuggestions(interaction) {
  if (await checkPerms(interaction, { scope: 'staff' })) return true;
  return false;
}

async function getSuggestionSettings(guildId) {
  const rows = await query('SELECT * FROM suggestion_settings WHERE guild_id = ? LIMIT 1', [guildId]);
  return rows[0] || null;
}

function statusLabel(status) {
  if (status === 'accepted') return 'Accepted';
  if (status === 'denied') return 'Denied';
  if (status === 'considering') return 'Considering';
  return 'N/A';
}

module.exports = {
  parseDuration,
  parseRoleIds,
  canManageSuggestions,
  getSuggestionSettings,
  statusLabel
};
