const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const rpsState = require('../utils/rpsState');
const { trackAchievementEvent } = require('../utils/achievementManager');

const CHOICES = ['rock', 'paper', 'scissors'];
const CHOICE_EMOJI = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️'
};

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

      const embed = new EmbedBuilder()
        .setColor(result === 'draw' ? 0xFEE75C : result === 'first' ? 0x57F287 : 0xED4245)
        .setTitle(`${resultEmoji(result)} Rock Paper Scissors`)
        .setDescription(
          `**${interaction.user.username}:** ${CHOICE_EMOJI[choice]} ${choice}\n` +
          `**${interaction.client.user.username}:** ${CHOICE_EMOJI[botChoice]} ${botChoice}\n\n` +
          `${resultText(result, interaction.user.username, interaction.client.user.username)}`
        );

      await interaction.reply({ embeds: [embed] });

      if (result === 'first') {
        await trackAchievementEvent({
          userId: interaction.user.id,
          event: 'rps_win',
          context: {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            channel: interaction.channel,
            userMention: `${interaction.user}`
          }
        });
      }

      return;
    }

    if (opponent.id === interaction.user.id) {
      return interaction.reply({ content: '<:warning:1496193692099285255> You cannot challenge yourself.', flags: MessageFlags.Ephemeral });
    }

    if (opponent.bot) {
      return interaction.reply({ content: '<:warning:1496193692099285255> You can only challenge human users or the bot directly.', flags: MessageFlags.Ephemeral });
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

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎮 Rock Paper Scissors Challenge')
      .setDescription(
        `${interaction.user} challenged ${opponent}.`
      )
      .setFooter({ text: 'Challenge expires in 2 minutes.' });

    return interaction.reply({
      embeds: [embed],
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

function resultEmoji(result) {
  if (result === 'draw') return '🤝';
  if (result === 'first') return '🏆';
  return '💥';
}

function resultText(result, firstUser, secondUser) {
  if (result === 'draw') return `It's a draw!`;
  if (result === 'first') return `${firstUser} wins!`;
  return `${secondUser} wins!`;
}

module.exports.decideWinner = decideWinner;
module.exports.resultText = resultText;
module.exports.resultEmoji = resultEmoji;
module.exports.CHOICE_EMOJI = CHOICE_EMOJI;
