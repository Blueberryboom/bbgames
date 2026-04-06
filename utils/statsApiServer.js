const http = require('http');
const { getBotNetworkCounts } = require('./botStats');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function startStatsApiServer(client) {
  const port = Number(process.env.STATS_API_PORT || 3000);
  if (!Number.isFinite(port) || port <= 0) {
    console.log('ℹ️ Stats API disabled: set STATS_API_PORT to a valid port.');
    return null;
  }

  const expectedApiKey = process.env.STATS_API_KEY?.trim();
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (!req.url || !req.url.startsWith('/api/stats')) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (expectedApiKey) {
      const providedApiKey = req.headers['x-api-key'];
      if (providedApiKey !== expectedApiKey) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
    }

    try {
      const counts = await getBotNetworkCounts(client);
      return sendJson(res, 200, {
        ok: true,
        guilds: counts.guildCount,
        members: counts.memberCount,
        shardId: client.shard?.ids?.[0] ?? 0,
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error('❌ Stats API error:', error);
      return sendJson(res, 500, { ok: false, error: 'Failed to fetch stats' });
    }
  });

  server.listen(port, () => {
    console.log(`🌐 Stats API listening on port ${port} at /api/stats`);
  });

  return server;
}

module.exports = {
  startStatsApiServer
};
