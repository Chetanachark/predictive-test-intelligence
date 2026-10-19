export function formatPrice(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(amount)
}

export function namesByPrice(direction = 'ascending', products) {
  const multiplier = direction === 'ascending' ? 1 : -1
  return [...products].sort((a, b) => multiplier * (a.price - b.price) || a.name.localeCompare(b.name))
    .map(product => product.name)
}
