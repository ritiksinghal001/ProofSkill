export default function CartItem({ item, onChange }) {
  return (
    <div>
      <span>{item.name}</span>
      <input type="number" value={item.qty} onChange={(e) => onChange(item.id, Number(e.target.value))} />
    </div>
  );
}
