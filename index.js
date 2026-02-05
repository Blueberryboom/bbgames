// Require the necessary discord.js classes
const { Client, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();

const token = process.env.TOKEN;

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Log in to Discord
client.login(token);
