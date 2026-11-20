export async function loadCart() {
  try {
    const res = await fetch('/api/cart');
    if (!res.ok) throw new Error('Cart request failed');
    return await res.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
