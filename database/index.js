const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5
});

module.exports = {
  pool,

  async query(sql, params) {
    let conn;
    try {
      conn = await pool.getConnection();
      return await conn.query(sql, params);
    } finally {
      if (conn) conn.release();
    }
  }
};
