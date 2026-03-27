const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    // Register /dice in Discord's slash command list.
    .setName('dice')
    // Keep command purpose explicit for users.
    .setDescription('Roll a six-sided dice'),

  async execute(interaction) {
    // Generate a fair integer from 1 to 6 (inclusive).
    const rolledNumber = Math.floor(Math.random() * 6) + 1;

    // Reply with the exact response format requested.
    await interaction.reply(`You rolled the dice and it landed on **${rolledNumber}**`);
  }
};
