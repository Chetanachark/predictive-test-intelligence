import { money } from '../api/client.js'

export default function CartItem({ item, onQuantity, onRemove }) {
  const maximum = Math.min(item.stock, 99)

  return (
    <article className="cart-item" aria-label={item.name}>
      <div>
        <h2>{item.name}</h2>
        <p>{money(item.price)} each</p>
      </div>
      <div>
        <label>
          Quantity for {item.name}
          <input type="number" min="1" max={maximum} step="1" value={item.quantity}
            onChange={event => onQuantity(item.id, Number(event.target.value))} />
        </label>
        <button type="button" className="secondary" aria-label={`Decrease quantity of ${item.name}`}
          disabled={item.quantity <= 1} onClick={() => onQuantity(item.id, item.quantity - 1)}>−</button>
        <button type="button" className="secondary" aria-label={`Increase quantity of ${item.name}`}
          disabled={item.quantity >= maximum} onClick={() => onQuantity(item.id, item.quantity + 1)}>+</button>
      </div>
      <strong>{money(item.price * item.quantity)}</strong>
      <button type="button" className="secondary" onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.name}`}>Remove</button>
    </article>
  )
}
