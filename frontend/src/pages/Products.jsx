import { useState } from 'react'
import { categories } from '../data/products.js'
import { useStore } from '../context/store.js'
import ProductCard from '../components/ProductCard.jsx'

const sorters = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  'price-asc': (a, b) => a.price - b.price || a.name.localeCompare(b.name),
  'price-desc': (a, b) => b.price - a.price || a.name.localeCompare(b.name),
}

export default function Products() {
  const { products, cart, addItem } = useStore()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('name-asc')
  const [notice, setNotice] = useState('')
  const query = search.trim().toLowerCase()
  const visibleProducts = products
    .filter(product =>
      (category === 'all' || product.category === category) &&
      product.name.toLowerCase().includes(query),
    )
    .sort(sorters[sort])

  function handleAdd(product) {
    const quantity = cart.find(item => item.id === product.id)?.quantity ?? 0
    if (quantity >= Math.min(product.stock, 99)) {
      setNotice(`No more ${product.name} can be added.`)
      return
    }
    addItem(product)
    setNotice(`${product.name} added to cart.`)
  }

  return (
    <section>
      <p className="eyebrow">The catalog</p>
      <h1>Products</h1>
      <p>Choose your tools. Build something great.</p>
      <div className="catalog-controls">
        <label>
          Search products
          <input type="search" value={search} placeholder="Search by product name"
            onChange={event => { setSearch(event.target.value); setNotice('') }} />
        </label>
        <label>
          Category
          <select value={category} onChange={event => {
            setCategory(event.target.value)
            setNotice('')
          }}>
            <option value="all">All categories</option>
            {categories.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Sort products
          <select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="price-asc">Price Low-High</option>
            <option value="price-desc">Price High-Low</option>
          </select>
        </label>
      </div>
      {visibleProducts.length ? (
        <div className="grid">
          {visibleProducts.map(product => (
            <ProductCard key={product.id} product={product} onAdd={handleAdd}
              quantityInCart={cart.find(item => item.id === product.id)?.quantity ?? 0} />
          ))}
        </div>
      ) : <p role="status">No products found.</p>}
      <p role="status">{notice}</p>
    </section>
  )
}
