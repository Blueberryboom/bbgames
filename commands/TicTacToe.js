const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  MessageFlags
} = require('discord.js');
const { trackAchievementEvent } = require('../utils/achievementManager');

const MAX_LEVEL = 5;

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

    const level = 1;
    const board = Array(9).fill(null);
    const symbols = { [player1.id]: 'X', [player2.id]: 'O' };

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Tic Tac Toe')
      .setDescription(renderDescription(player1, player2, player1, aiMode ? level : null));

    const message = await interaction.reply({
      embeds: [embed],
      components: createComponents(board),
      fetchReply: true
    });

    await runGame({ message, player1, player2, aiMode, level, board, symbols, currentPlayer: player1 });
  }
};

async function runGame({ message, player1, player2, aiMode, level, board, symbols, currentPlayer }) {
  let gameOver = false;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000
  });

  collector.on('collect', async i => {
    if (gameOver) return;

    if (!i.customId.startsWith('ttt_cell_')) return;

    if (!aiMode && ![player1.id, player2.id].includes(i.user.id)) {
      return i.reply({ content: "You're not part of this game!", flags: MessageFlags.Ephemeral });
    }

    if (aiMode && i.user.id !== player1.id) {
      return i.reply({ content: "You're not part of this game!", flags: MessageFlags.Ephemeral });
    }

    if (i.user.id !== currentPlayer.id) {
      return i.reply({ content: "It's not your turn!", flags: MessageFlags.Ephemeral });
    }

    const index = Number(i.customId.replace('ttt_cell_', ''));
    if (!Number.isInteger(index) || index < 0 || index > 8) return;

    if (board[index]) {
      return i.reply({ content: 'That spot is taken!', flags: MessageFlags.Ephemeral });
    }

    board[index] = symbols[currentPlayer.id];

    const winner = checkWinner(board);
    if (winner || !board.includes(null)) {
      collector.stop('finished');
      gameOver = true;
      const rematchLevel = aiMode ? Math.min(level + 1, MAX_LEVEL) : null;

      await i.update({
        embeds: [buildResultEmbed(player1, player2, winner, aiMode ? level : null)],
        components: createComponents(board, true, rematchLevel)
      });

      if (winner === 'X') {
        await trackAchievementEvent({
          userId: player1.id,
          event: 'tictactoe_win',
          context: {
            guildId: message.guildId,
            channelId: message.channelId,
            channel: message.channel,
            userMention: `<@${player1.id}>`
          }
        });
      } else if (winner === 'O' && player2.id !== 'AI') {
        await trackAchievementEvent({
          userId: player2.id,
          event: 'tictactoe_win',
          context: {
            guildId: message.guildId,
            channelId: message.channelId,
            channel: message.channel,
            userMention: `<@${player2.id}>`
          }
        });
      }

      if (aiMode) {
        await awaitRematch({ message, player1, player2, nextLevel: rematchLevel });
      }
      return;
    }

    if (aiMode) {
      currentPlayer = player2;

      await i.update({
        embeds: [buildTurnEmbed(player1, player2, currentPlayer, level)],
        components: createComponents(board)
      });

      setTimeout(async () => {
        if (gameOver) return;

        const aiMove = getAIMove(board, level);
        board[aiMove] = symbols[player2.id];

        const aiWinner = checkWinner(board);
        if (aiWinner || !board.includes(null)) {
          gameOver = true;
          collector.stop('finished');
          const rematchLevel = Math.min(level + 1, MAX_LEVEL);

          await message.edit({
            embeds: [buildResultEmbed(player1, player2, aiWinner, level)],
            components: createComponents(board, true, rematchLevel)
          }).catch(() => {});

          if (aiWinner === 'X') {
            await trackAchievementEvent({
              userId: player1.id,
              event: 'tictactoe_win',
              context: {
                guildId: message.guildId,
                channelId: message.channelId,
                channel: message.channel,
                userMention: `<@${player1.id}>`
              }
            });
          }

          await awaitRematch({ message, player1, player2, nextLevel: rematchLevel });
          return;
        }

        currentPlayer = player1;
        await message.edit({
          embeds: [buildTurnEmbed(player1, player2, currentPlayer, level)],
          components: createComponents(board)
        }).catch(() => {});
      }, 550);

      return;
    }

    currentPlayer = currentPlayer.id === player1.id ? player2 : player1;

    await i.update({
      embeds: [buildTurnEmbed(player1, player2, currentPlayer)],
      components: createComponents(board)
    });
  });

  collector.on('end', async (_, reason) => {
    if (!gameOver && reason !== 'finished') {
      await message.edit({ components: createComponents(board, true) }).catch(() => {});
    }
  });
}

async function awaitRematch({ message, player1, player2, nextLevel }) {
  const rematchCollector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000
  });

  rematchCollector.on('collect', async i => {
    if (!i.customId.startsWith('ttt_rematch_')) return;

    if (i.user.id !== player1.id) {
      return i.reply({ content: 'Only the player who started this AI game can rematch.', flags: MessageFlags.Ephemeral });
    }

    const level = Number(i.customId.replace('ttt_rematch_', ''));
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return;

    rematchCollector.stop('rematch');

    const board = Array(9).fill(null);
    const symbols = { [player1.id]: 'X', [player2.id]: 'O' };

    await i.update({
      embeds: [buildTurnEmbed(player1, player2, player1, level)],
      components: createComponents(board)
    });

    await runGame({ message, player1, player2, aiMode: true, level, board, symbols, currentPlayer: player1 });
  });

  rematchCollector.on('end', async (_, reason) => {
    if (reason !== 'rematch') {
      const components = message.components;
      if (components.length) {
        const disabled = components.map(row => {
          const nextRow = ActionRowBuilder.from(row);
          nextRow.setComponents(row.components.map(component => ButtonBuilder.from(component).setDisabled(true)));
          return nextRow;
        });
        await message.edit({ components: disabled }).catch(() => {});
      }
    }
  });
}

function buildTurnEmbed(p1, p2, current, level = null) {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('Tic Tac Toe')
    .setDescription(renderDescription(p1, p2, current, level));
}

function renderDescription(p1, p2, current, level = null) {
  const levelLine = Number.isInteger(level) ? `\n🤖 **AI Level:** ${level}` : '';
  return `❌ **${p1.tag}**\n⭕ **${p2.tag}**${levelLine}\n\nCurrent Turn: **${current.tag}**`;
}

function buildResultEmbed(p1, p2, winner, level = null) {
  let resultText = "🤝 It's a draw!";

  if (winner === 'X') resultText = `🏆 **${p1.tag} wins!**`;
  if (winner === 'O') resultText = `🏆 **${p2.tag} wins!**`;

  const levelLine = Number.isInteger(level) ? `\n🤖 **AI Level:** ${level}` : '';

  return new EmbedBuilder()
    .setColor(winner ? '#2ecc71' : '#f1c40f')
    .setTitle('Tic Tac Toe')
    .setDescription(`❌ **${p1.tag}**\n⭕ **${p2.tag}**${levelLine}\n\n${resultText}`);
}

function createComponents(board, disabled = false, rematchLevel = null) {
  const rows = [];

  for (let i = 0; i < 3; i++) {
    const row = new ActionRowBuilder();

    for (let j = 0; j < 3; j++) {
      const index = i * 3 + j;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_cell_${index}`)
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

  if (Number.isInteger(rematchLevel)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_rematch_${rematchLevel}`)
          .setLabel(`Rematch (${rematchLevel})`)
          .setStyle(ButtonStyle.Primary)
      )
    );
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

function getAIMove(board, level) {
  const open = getOpenCells(board);
  if (!open.length) return 0;

  if (level === 1) {
    return randomFrom(open);
  }

  const winMove = findWinningMove(board, 'O');
  if (level >= 2 && winMove !== null) return winMove;

  if (level === 2) {
    return randomFrom(open);
  }

  const blockMove = findWinningMove(board, 'X');
  if (level >= 3 && blockMove !== null) return blockMove;

  if (level === 3) {
    if (open.includes(4)) return 4;
    const corners = [0, 2, 6, 8].filter(index => open.includes(index));
    if (corners.length) return randomFrom(corners);
    return randomFrom(open);
  }

  if (level === 4) {
    if (Math.random() < 0.75) {
      return getMinimaxMove(board);
    }

    if (open.includes(4)) return 4;
    const corners = [0, 2, 6, 8].filter(index => open.includes(index));
    if (corners.length) return randomFrom(corners);
    return randomFrom(open);
  }

  return getMinimaxMove(board);
}

function getOpenCells(board) {
  return board
    .map((value, index) => (value === null ? index : null))
    .filter(index => index !== null);
}

function randomFrom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function findWinningMove(board, symbol) {
  for (const index of getOpenCells(board)) {
    board[index] = symbol;
    const win = checkWinner(board) === symbol;
    board[index] = null;

    if (win) return index;
  }

  return null;
}

function getMinimaxMove(board) {
  let bestScore = -Infinity;
  let bestMove = getOpenCells(board)[0];

  for (const index of getOpenCells(board)) {
    board[index] = 'O';
    const score = minimax(board, false, 0);
    board[index] = null;

    if (score > bestScore) {
      bestScore = score;
      bestMove = index;
    }
  }

  return bestMove;
}

function minimax(board, isMaximizing, depth) {
  const winner = checkWinner(board);
  if (winner === 'O') return 10 - depth;
  if (winner === 'X') return depth - 10;

  const open = getOpenCells(board);
  if (!open.length) return 0;

  if (isMaximizing) {
    let best = -Infinity;

    for (const index of open) {
      board[index] = 'O';
      best = Math.max(best, minimax(board, false, depth + 1));
      board[index] = null;
    }

    return best;
  }

  let best = Infinity;

  for (const index of open) {
    board[index] = 'X';
    best = Math.min(best, minimax(board, true, depth + 1));
    board[index] = null;
  }

  return best;
}
