import { money } from '../api/client.js'

export default function ProductCard({ product, onAdd, quantityInCart = 0 }) {
  const outOfStock = product.stock === 0
  const atLimit = quantityInCart >= Math.min(product.stock, 99)

  return (
    <article className="card" aria-label={product.name}>
      <span className="product-icon" aria-hidden="true">{product.name.slice(0, 1)}</span>
      <h2>{product.name}</h2>
      <p className="price">{money(product.price)}</p>
      <p>{outOfStock ? 'Out of Stock' : `In stock: ${product.stock}`}</p>
      {!outOfStock && atLimit && <p>Stock limit reached in cart.</p>}
      <button type="button" disabled={outOfStock || atLimit}
        onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
        {outOfStock ? 'Out of Stock' : 'Add to cart'}
      </button>
    </article>
  )
}
