const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType
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
      player2 = { id: 'AI', tag: 'Playing against AI.' };
    } else {
      if (opponent.bot)
        return interaction.reply({ content: "You can't play against bots!", ephemeral: true });

      if (opponent.id === player1.id)
        return interaction.reply({ content: "You can't play against yourself!", ephemeral: true });

      player2 = opponent;
    }

    const board = Array(9).fill(null);
    let currentPlayer = player1;
    let gameOver = false;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Tic Tac Toe')
      .setDescription(
        `❌ **${player1.tag}**\n` +
        `⭕ **${aiMode ? player2.tag : player2.tag}**\n\n` +
        `Current Turn: **${player1.tag}**`
      );

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

      if (!aiMode && ![player1.id, player2.id].includes(i.user.id))
        return i.reply({ content: "You're not part of this game!", ephemeral: true });

      if (i.user.id !== currentPlayer.id)
        return i.reply({ content: "It's not your turn!", ephemeral: true });

      const index = parseInt(i.customId);

      if (board[index])
        return i.reply({ content: "That spot is taken!", ephemeral: true });

      board[index] = 'X';

      let winner = checkWinner(board);

      if (winner || !board.includes(null)) {
        return endGame(winner, board, embed, message, collector, player1, player2);
      }

      if (aiMode) {
        currentPlayer = player2;

        await i.update({
          embeds: [updateEmbed(embed, player1, player2, currentPlayer, aiMode)],
          components: createBoard(board)
        });

        setTimeout(async () => {

          const aiMove = minimax(board, 'O').index;
          board[aiMove] = 'O';

          winner = checkWinner(board);

          if (winner || !board.includes(null)) {
            return endGame(winner, board, embed, message, collector, player1, player2);
          }

          currentPlayer = player1;

          await message.edit({
            embeds: [updateEmbed(embed, player1, player2, currentPlayer, aiMode)],
            components: createBoard(board)
          });

        }, 700);

      } else {
        currentPlayer = currentPlayer.id === player1.id ? player2 : player1;

        await i.update({
          embeds: [updateEmbed(embed, player1, player2, currentPlayer)],
          components: createBoard(board)
        });
      }
    });

    collector.on('end', () => {
      if (!gameOver) {
        message.edit({
          components: createBoard(board, true)
        }).catch(() => {});
      }
    });

    function endGame(winner, board, embed, message, collector, p1, p2) {
      gameOver = true;
      collector.stop();

      let resultText;

      if (!winner) {
        resultText = "🤝 It's a draw!";
      } else if (winner === 'X') {
        resultText = `🏆 **${p1.tag} wins!**`;
      } else {
        resultText = `🏆 **${p2.tag} wins!**`;
      }

      const finalEmbed = EmbedBuilder.from(embed)
        .setDescription(
          `❌ **${p1.tag}**\n` +
          `⭕ **${p2.tag}**\n\n` +
          resultText
        )
        .setColor(winner ? '#2ecc71' : '#f1c40f');

      message.edit({
        embeds: [finalEmbed],
        components: createBoard(board, true)
      });
    }
  }
};

function createBoard(board, disabled = false) {
  const rows = [];

  for (let i = 0; i < 3; i++) {
    const row = new ActionRowBuilder();

    for (let j = 0; j < 3; j++) {
      const index = i * 3 + j;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(index.toString())
          .setLabel(board[index] ? board[index] : '⬜')
          .setStyle(
            board[index] === 'X'
              ? ButtonStyle.Danger
              : board[index] === 'O'
              ? ButtonStyle.Success
              : ButtonStyle.Secondary
          )
          .setDisabled(disabled || board[index])
      );
    }

    rows.push(row);
  }

  return rows;
}

function updateEmbed(embed, p1, p2, current, aiMode = false) {
  return EmbedBuilder.from(embed)
    .setDescription(
      `❌ **${p1.tag}**\n` +
      `⭕ **${p2.tag}**\n\n` +
      `Current Turn: **${current.tag}**`
    );
}

function checkWinner(board) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];

  for (const [a,b,c] of wins) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function minimax(newBoard, player) {
  const availSpots = newBoard
    .map((v,i) => v === null ? i : null)
    .filter(v => v !== null);

  const winner = checkWinner(newBoard);

  if (winner === 'X') return { score: -10 };
  if (winner === 'O') return { score: 10 };
  if (availSpots.length === 0) return { score: 0 };

  const moves = [];

  for (let i = 0; i < availSpots.length; i++) {
    const move = {};
    move.index = availSpots[i];

    newBoard[availSpots[i]] = player;

    if (player === 'O') {
      const result = minimax(newBoard, 'X');
      move.score = result.score;
    } else {
      const result = minimax(newBoard, 'O');
      move.score = result.score;
    }

    newBoard[availSpots[i]] = null;
    moves.push(move);
  }

  let bestMove;
  if (player === 'O') {
    let bestScore = -10000;
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].score > bestScore) {
        bestScore = moves[i].score;
        bestMove = i;
      }
    }
  } else {
    let bestScore = 10000;
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].score < bestScore) {
        bestScore = moves[i].score;
        bestMove = i;
      }
    }
  }

  return moves[bestMove];
}
