const pool = require('../database');

module.exports = async (interaction) => {

  // Server admins always allowed
  if (interaction.member.permissions.has("Administrator"))
    return true;

  // Check DB roles
  const allowedRoles = await pool.query(
    "SELECT role_id FROM event_admin_roles WHERE guild_id = ?",
    [interaction.guildId]
  );

  return allowedRoles.some(r =>
    interaction.member.roles.cache.has(r.role_id)
  );
};
