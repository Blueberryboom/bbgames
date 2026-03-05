const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  MessageFlags
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tictactoe')
    .setDescription('Play Tic Tac Toe!')
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('Who do you want to play against?')
        .setRequired(false)
    ),

  async execute(interaction) {
    const player1 = interaction.user;
    const opponent = interaction.options.getUser('opponent');

    let player2;
    let aiMode = false;

    if (!opponent) {
      aiMode = true;
      player2 = { id: 'AI', tag: 'AI Opponent' };
    } else {
      if (opponent.bot) {
        return interaction.reply({ content: "You can't play against bots!", flags: MessageFlags.Ephemeral });
      }

      if (opponent.id === player1.id) {
        return interaction.reply({ content: "You can't play against yourself!", flags: MessageFlags.Ephemeral });
      }

      player2 = opponent;
    }

    const board = Array(9).fill(null);
    const symbols = {
      [player1.id]: 'X',
      [player2.id]: 'O'
    };

    let currentPlayer = player1;
    let gameOver = false;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Tic Tac Toe')
      .setDescription(renderDescription(player1, player2, currentPlayer));

    const message = await interaction.reply({
      embeds: [embed],
      components: createBoard(board),
      fetchReply: true
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000
    });

    collector.on('collect', async i => {
      if (gameOver) return;

      if (!aiMode && ![player1.id, player2.id].includes(i.user.id)) {
        return i.reply({ content: "You're not part of this game!", flags: MessageFlags.Ephemeral });
      }

      if (i.user.id !== currentPlayer.id) {
        return i.reply({ content: "It's not your turn!", flags: MessageFlags.Ephemeral });
      }

      const index = Number(i.customId);
      if (!Number.isInteger(index) || index < 0 || index > 8) return;

      if (board[index]) {
        return i.reply({ content: 'That spot is taken!', flags: MessageFlags.Ephemeral });
      }

      board[index] = symbols[currentPlayer.id];

      const winner = checkWinner(board);
      if (winner || !board.includes(null)) {
        collector.stop();
        gameOver = true;
        return i.update({
          embeds: [buildResultEmbed(player1, player2, winner)],
          components: createBoard(board, true)
        });
      }

      if (aiMode) {
        currentPlayer = player2;

        await i.update({
          embeds: [EmbedBuilder.from(embed).setDescription(renderDescription(player1, player2, currentPlayer))],
          components: createBoard(board)
        });

        setTimeout(async () => {
          if (gameOver) return;

          const aiMove = getBestMove(board);
          board[aiMove] = symbols[player2.id];

          const aiWinner = checkWinner(board);
          if (aiWinner || !board.includes(null)) {
            gameOver = true;
            collector.stop();
            await message.edit({
              embeds: [buildResultEmbed(player1, player2, aiWinner)],
              components: createBoard(board, true)
            }).catch(() => {});
            return;
          }

          currentPlayer = player1;
          await message.edit({
            embeds: [EmbedBuilder.from(embed).setDescription(renderDescription(player1, player2, currentPlayer))],
            components: createBoard(board)
          }).catch(() => {});
        }, 650);

        return;
      }

      currentPlayer = currentPlayer.id === player1.id ? player2 : player1;

      await i.update({
        embeds: [EmbedBuilder.from(embed).setDescription(renderDescription(player1, player2, currentPlayer))],
        components: createBoard(board)
      });
    });

    collector.on('end', () => {
      if (!gameOver) {
        message.edit({ components: createBoard(board, true) }).catch(() => {});
      }
    });
  }
};

function renderDescription(p1, p2, current) {
  return `❌ **${p1.tag}**\n⭕ **${p2.tag}**\n\nCurrent Turn: **${current.tag}**`;
}

function buildResultEmbed(p1, p2, winner) {
  let resultText = "🤝 It's a draw!";

  if (winner === 'X') resultText = `🏆 **${p1.tag} wins!**`;
  if (winner === 'O') resultText = `🏆 **${p2.tag} wins!**`;

  return new EmbedBuilder()
    .setColor(winner ? '#2ecc71' : '#f1c40f')
    .setTitle('Tic Tac Toe')
    .setDescription(`❌ **${p1.tag}**\n⭕ **${p2.tag}**\n\n${resultText}`);
}

function createBoard(board, disabled = false) {
  const rows = [];

  for (let i = 0; i < 3; i++) {
    const row = new ActionRowBuilder();

    for (let j = 0; j < 3; j++) {
      const index = i * 3 + j;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(String(index))
          .setLabel(board[index] ? board[index] : '⬜')
          .setStyle(
            board[index] === 'X'
              ? ButtonStyle.Danger
              : board[index] === 'O'
                ? ButtonStyle.Success
                : ButtonStyle.Secondary
          )
          .setDisabled(Boolean(disabled || board[index]))
      );
    }

    rows.push(row);
  }

  return rows;
}

function checkWinner(board) {
  const wins = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  for (const [a, b, c] of wins) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function getBestMove(board) {
  const open = board
    .map((value, index) => (value === null ? index : null))
    .filter(index => index !== null);

  if (open.includes(4)) return 4;

  return open[Math.floor(Math.random() * open.length)];
}
