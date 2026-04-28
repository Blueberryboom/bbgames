const FEATURE_USAGE_QUERIES = [
  ['Counting', 'SELECT COUNT(*) AS total FROM counting WHERE channel_id IS NOT NULL'],
  ['Leveling', 'SELECT COUNT(*) AS total FROM leveling_settings WHERE enabled = 1'],
  ['Welcome messages', 'SELECT COUNT(*) AS total FROM member_event_messages WHERE event_type = ? AND enabled = 1', ['welcome']],
  ['Boost messages', 'SELECT COUNT(*) AS total FROM member_event_messages WHERE event_type = ? AND enabled = 1', ['boost']],
  ['Bumping', 'SELECT COUNT(*) AS total FROM bumping_configs WHERE enabled = 1 AND channel_id IS NOT NULL AND advertisement IS NOT NULL'],
  ['Logs', 'SELECT COUNT(*) AS total FROM guild_logs_settings WHERE enabled = 1'],
  ['YouTube alerts', 'SELECT COUNT(*) AS total FROM youtube_subscriptions'],
  ['Suggestions', 'SELECT COUNT(*) AS total FROM suggestion_settings WHERE channel_id IS NOT NULL'],
  ['Tickets', 'SELECT COUNT(*) AS total FROM ticket_settings WHERE category_id IS NOT NULL'],
  ['Starboard', 'SELECT COUNT(*) AS total FROM starboard_configs']
];

async function getTopFeatureLeaderboard(query, limit = 10) {
  const rows = await Promise.all(
    FEATURE_USAGE_QUERIES.map(([, sql, params = []]) => query(sql, params))
  );

  return FEATURE_USAGE_QUERIES
    .map(([name], index) => [name, Number(rows[index]?.[0]?.total || 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

module.exports = {
  getTopFeatureLeaderboard
};
