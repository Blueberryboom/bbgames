require('dotenv').config();
const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "mariadb",
  user: process.env.DB_USER || "bbgames",
  password: process.env.DB_PASS || "bbgames",
  database: process.env.DB_NAME || "bbgames",
  connectionLimit: 5
});

// ⭐ IMPORTANT – always return rows directly
async function query(sql, params = []) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  query
};
