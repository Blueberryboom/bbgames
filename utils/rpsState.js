const crypto = require('crypto');

const EXPIRY_MS = 2 * 60 * 1000;
const pendingGames = new Map();

function createGame(payload) {
  const id = crypto.randomBytes(8).toString('hex');
  pendingGames.set(id, { ...payload, createdAt: Date.now() });
  cleanupExpired();
  return id;
}

function getGame(id) {
  const game = pendingGames.get(id);
  if (!game) return null;

  if (Date.now() - game.createdAt > EXPIRY_MS) {
    pendingGames.delete(id);
    return null;
  }

  return game;
}

function consumeGame(id) {
  const game = getGame(id);
  if (!game) return null;
  pendingGames.delete(id);
  return game;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, game] of pendingGames.entries()) {
    if (now - game.createdAt > EXPIRY_MS) {
      pendingGames.delete(id);
    }
  }
}

module.exports = {
  createGame,
  getGame,
  consumeGame
};
