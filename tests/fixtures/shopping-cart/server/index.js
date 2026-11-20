const express = require('express');
const app = express();
const cart = [{ id: 1, name: 'Mug', price: 800, qty: 1 }];

app.use(express.json());

app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

app.get('/api/cart', (req, res) => {
  res.json(cart);
});

app.post('/api/cart', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  cart.push({ id: cart.length + 1, ...req.body });
  res.status(201).json(cart);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(3000);
