const pool = require('../database');

module.exports = async (interaction, options = {}) => {
  const scope = options.scope || 'global';

  if (!interaction.guildId || !interaction.member) {
    return false;
  }

  if (interaction.member.permissions.has('Administrator')) {
    return true;
  }

  const botManagerRoles = await pool.query(
    'SELECT role_id FROM admin_roles WHERE guild_id = ?',
    [interaction.guildId]
  );

  const hasBotManagerRole = botManagerRoles.some(role =>
    interaction.member.roles.cache.has(role.role_id)
  );

  if (hasBotManagerRole) {
    return true;
  }

  if (scope !== 'giveaway') {
    return false;
  }

  const giveawayAdminRoles = await pool.query(
    'SELECT role_id FROM giveaway_admin_roles WHERE guild_id = ?',
    [interaction.guildId]
  );

  return giveawayAdminRoles.some(role =>
    interaction.member.roles.cache.has(role.role_id)
  );
};
