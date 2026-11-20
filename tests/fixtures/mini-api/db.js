const { Pool } = require('pg');
const pool = new Pool();

exports.getProduct = async (id) => {
  const r = await pool.query('SELECT id, name, price FROM products WHERE id = $1', [id]);
  return r.rows[0];
};

exports.ordersWithCustomers = async () => {
  const r = await pool.query(
    'SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.total > 0'
  );
  return r.rows;
};
