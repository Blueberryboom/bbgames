const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const rpsState = require('../utils/rpsState');

const CHOICES = ['rock', 'paper', 'scissors'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play rock paper scissors against the bot or another user')
    .addStringOption(option =>
      option
        .setName('choice')
        .setDescription('Your choice')
        .setRequired(true)
        .addChoices(
          { name: 'Rock', value: 'rock' },
          { name: 'Paper', value: 'paper' },
          { name: 'Scissors', value: 'scissors' }
        )
    )
    .addUserOption(option =>
      option
        .setName('opponent')
        .setDescription('Challenge another user (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const choice = interaction.options.getString('choice', true);
    const opponent = interaction.options.getUser('opponent');

    if (!opponent || opponent.id === interaction.client.user.id) {
      const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
      const result = decideWinner(choice, botChoice);

      return interaction.reply(`🪨📄✂️ You picked **${choice}**. I picked **${botChoice}**.\n${resultText(result, interaction.user, interaction.client.user)}`);
    }

    if (opponent.id === interaction.user.id) {
      return interaction.reply({ content: '❌ You cannot challenge yourself.', flags: MessageFlags.Ephemeral });
    }

    if (opponent.bot) {
      return interaction.reply({ content: '❌ You can only challenge human users or the bot directly.', flags: MessageFlags.Ephemeral });
    }

    const gameId = rpsState.createGame({
      guildId: interaction.guildId,
      challengerId: interaction.user.id,
      opponentId: opponent.id,
      challengerChoice: choice
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rps_pick_${gameId}_rock`).setLabel('Rock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rps_pick_${gameId}_paper`).setLabel('Paper').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rps_pick_${gameId}_scissors`).setLabel('Scissors').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content: `${opponent}, ${interaction.user} challenged you to Rock Paper Scissors! Choose below (expires in 2 minutes).`,
      components: [buttons]
    });
  }
};

function decideWinner(first, second) {
  if (first === second) return 'draw';
  if (
    (first === 'rock' && second === 'scissors')
    || (first === 'paper' && second === 'rock')
    || (first === 'scissors' && second === 'paper')
  ) {
    return 'first';
  }
  return 'second';
}

function resultText(result, firstUser, secondUser) {
  if (result === 'draw') return `🤝 It's a draw!`;
  if (result === 'first') return `🏆 ${firstUser} wins!`;
  return `🏆 ${secondUser} wins!`;
}

module.exports.decideWinner = decideWinner;
module.exports.resultText = resultText;
