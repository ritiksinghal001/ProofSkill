import { useState, useEffect } from 'react';
import CartItem from './CartItem.jsx';
import { loadCart, formatPrice } from './api.js';

export default function Cart() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    loadCart().then((data) => setItems(data));
  }, []);

  function changeQty(id, next) {
    setItems(items.map((i) => (i.id === id ? { ...i, qty: next } : i)));
  }

  const total = items.reduce((t, i) => t + i.price * i.qty, 0);

  return (
    <section>
      <h2>Cart</h2>
      {items.map((i) => (
        <CartItem key={i.id} item={i} onChange={changeQty} />
      ))}
      <p>Total: {formatPrice(total)}</p>
    </section>
  );
}
