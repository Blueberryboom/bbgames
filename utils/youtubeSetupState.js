const crypto = require('crypto');

const EXPIRY_MS = 10 * 60 * 1000;
const pending = new Map();

module.exports = {
  create(payload) {
    const token = crypto.randomBytes(12).toString('hex');
    pending.set(token, { ...payload, createdAt: Date.now() });
    cleanupExpired();
    return token;
  },

  get(token) {
    const data = pending.get(token);
    if (!data) return null;

    if (Date.now() - data.createdAt > EXPIRY_MS) {
      pending.delete(token);
      return null;
    }

    return data;
  },

  consume(token) {
    const data = this.get(token);
    if (!data) return null;

    pending.delete(token);
    return data;
  }
};

function cleanupExpired() {
  const now = Date.now();
  for (const [token, data] of pending.entries()) {
    if (now - data.createdAt > EXPIRY_MS) {
      pending.delete(token);
    }
  }
}
