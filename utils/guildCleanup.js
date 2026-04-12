const { query } = require('../database');

const GUILD_DATA_DELETE_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
let cleanupInterval = null;

async function clearGuildData(guildId) {
  if (!guildId) return;

  await query(
    `DELETE ge FROM giveaway_entries ge
     INNER JOIN giveaways g ON ge.giveaway_id = g.id
     WHERE g.guild_id = ?`,
    [guildId]
  );

  await query('DELETE FROM giveaways WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM youtube_subscriptions WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM minecraft_monitors WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM welcome_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM member_event_messages WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM guild_logs_events WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM guild_logs_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM sticky_messages WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM auto_messages WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM auto_responders WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM admin_roles WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM giveaway_admin_roles WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM staff_roles WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM counting WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM counting_leaderboard WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM leveling_users WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM leveling_role_rewards WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM leveling_xp_events WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM leveling_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM birthday_users WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM birthday_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM support_requests WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_types WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM tickets WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_automations WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_automation_close_requests WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_blacklist WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM ticket_user_activity WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM blacklist WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM tags WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM tag_allowed_roles WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM tag_usage_stats WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM one_word_story_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM one_word_story_contributions WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM starboard_posts WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM starboard_configs WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM starboard_banned_users WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM suggestion_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM suggestion_categories WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM suggestion_blacklist WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM suggestion_user_activity WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM suggestions WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM servertag_reward_settings WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM bumping_configs WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM bumping_usage WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM bumping_channel_usage WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM guild_deletion_queue WHERE guild_id = ?', [guildId]);
  await query('DELETE FROM guild_data_deletion_approvals WHERE guild_id = ?', [guildId]);
}

async function scheduleGuildDataDeletion(guildId, reason = 'bot_removed', delayMs = GUILD_DATA_DELETE_DELAY_MS) {
  if (!guildId) return;

  const now = Date.now();
  await query(
    `REPLACE INTO guild_deletion_queue (guild_id, delete_after, reason, queued_at)
     VALUES (?, ?, ?, ?)`,
    [guildId, now + delayMs, reason, now]
  );
}

async function cancelGuildDataDeletion(guildId) {
  if (!guildId) return;
  await query('DELETE FROM guild_deletion_queue WHERE guild_id = ?', [guildId]);
}

async function processPendingGuildDeletions() {
  const now = Date.now();
  const rows = await query(
    `SELECT guild_id
     FROM guild_deletion_queue
     WHERE delete_after <= ?`,
    [now]
  );

  for (const row of rows) {
    try {
      await clearGuildData(row.guild_id);
      console.log(`🧹 Deleted delayed guild data for ${row.guild_id}`);
    } catch (error) {
      console.error(`❌ Failed delayed guild cleanup for ${row.guild_id}:`, error.message || error);
    }
  }
}

function startGuildCleanupScheduler(client) {
  const shardId = client.shard?.ids?.[0] ?? 0;
  if (client.shard && shardId !== 0) return;

  if (cleanupInterval) clearInterval(cleanupInterval);

  processPendingGuildDeletions().catch(err => {
    console.error('❌ Initial delayed guild cleanup check failed:', err);
  });

  cleanupInterval = setInterval(() => {
    processPendingGuildDeletions().catch(err => {
      console.error('❌ Delayed guild cleanup check failed:', err);
    });
  }, 60 * 60 * 1000);
  cleanupInterval.unref?.();
}

module.exports = {
  GUILD_DATA_DELETE_DELAY_MS,
  clearGuildData,
  scheduleGuildDataDeletion,
  cancelGuildDataDeletion,
  processPendingGuildDeletions,
  startGuildCleanupScheduler
};
