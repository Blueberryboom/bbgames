const { ShardingManager } = require('discord.js');
require('dotenv').config();

const manager = new ShardingManager('./index.js', {
  token: process.env.TOKEN,
  totalShards: 'auto'
});

manager.on('shardCreate', shard =>
  console.log(`🧩 Shard ${shard.id} launched`)
);

manager.spawn();
