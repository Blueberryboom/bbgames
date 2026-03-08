const pool = require('../database');

module.exports = async (interaction) => {
  if (!interaction.guildId || !interaction.member) {
    return false;
  }

  if (interaction.member.permissions.has('Administrator')) {
    return true;
  }

  const allowedRoles = await pool.query(
    'SELECT role_id FROM admin_roles WHERE guild_id = ?',
    [interaction.guildId]
  );

  return allowedRoles.some(r => interaction.member.roles.cache.has(r.role_id));
};
