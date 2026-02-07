const pool = require('../database');

// ─── ⭐ GLOBAL BOT OWNERS ─────────────────────
// These users bypass ALL permission checks
const GLOBAL_OWNERS = [
  "1056523021894029372"
];

module.exports = async (interaction) => {

  // ─── GLOBAL OVERRIDE ───────────────────────
  if (GLOBAL_OWNERS.includes(interaction.user.id)) {
    return true;
  }

  // ─── SERVER ADMINS ALWAYS ALLOWED ──────────
  if (interaction.member.permissions.has("Administrator"))
    return true;

  // ─── CHECK DB ROLES ────────────────────────
  const allowedRoles = await pool.query(
    "SELECT role_id FROM event_admin_roles WHERE guild_id = ?",
    [interaction.guildId]
  );

  return allowedRoles.some(r =>
    interaction.member.roles.cache.has(r.role_id)
  );
};
