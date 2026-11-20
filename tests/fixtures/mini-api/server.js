const express = require('express');
const db = require('./db.js');
const app = express();
app.use(express.json());

app.get('/products/:id', async (req, res) => {
  const row = await db.getProduct(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

app.get('/orders', async (req, res) => {
  res.json(await db.ordersWithCustomers());
});

app.listen(4000);
