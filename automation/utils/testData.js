export const demoUser = Object.freeze({ email: 'student@example.com', password: 'Student@123' })
export const customer = Object.freeze({ name: 'Test Student', email: 'student@example.com', address: 'Test Campus, Bengaluru' })
export const coupons = Object.freeze({ invalid: 'INVALID', save10: 'SAVE10', welcome20: 'WELCOME20' })
export const primaryProduct = Object.freeze({ name: 'Laptop', price: 50000 })
export const secondProduct = Object.freeze({ name: 'Monitor', price: 15000, stock: 2 })
export const orderNumberPattern = /^ORD-[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/

// Independent test oracle: do not import expectations from the application source.
export const catalog = [
  { name: 'Laptop', price: 50000, category: 'Laptops' },
  { name: 'Smartphone', price: 25000, category: 'Mobiles' },
  { name: 'Headphones', price: 3000, category: 'Accessories' },
  { name: 'Monitor', price: 15000, category: 'Monitors' },
  { name: 'Ultrabook', price: 75000, category: 'Laptops' },
  { name: 'Student Laptop', price: 35000, category: 'Laptops' },
  { name: 'Business Laptop', price: 65000, category: 'Laptops' },
  { name: 'Convertible Laptop', price: 80000, category: 'Laptops' },
  { name: 'Budget Smartphone', price: 12000, category: 'Mobiles' },
  { name: 'Flagship Smartphone', price: 70000, category: 'Mobiles' },
  { name: 'Compact Smartphone', price: 30000, category: 'Mobiles' },
  { name: 'Foldable Smartphone', price: 95000, category: 'Mobiles' },
  { name: 'Wireless Mouse', price: 1500, category: 'Accessories' },
  { name: 'USB Keyboard', price: 2000, category: 'Accessories' },
  { name: 'USB-C Hub', price: 3500, category: 'Accessories' },
  { name: 'Laptop Stand', price: 2500, category: 'Accessories' },
  { name: 'Full HD Monitor', price: 12000, category: 'Monitors' },
  { name: '4K Monitor', price: 35000, category: 'Monitors' },
  { name: 'Ultrawide Monitor', price: 45000, category: 'Monitors' },
  { name: 'Portable Monitor', price: 18000, category: 'Monitors' },
  { name: 'Gaming Laptop', price: 90000, category: 'Gaming' },
  { name: 'Gaming Mouse', price: 4000, category: 'Gaming' },
  { name: 'Gaming Keyboard', price: 6000, category: 'Gaming' },
  { name: 'Gaming Headset', price: 5000, category: 'Gaming' },
  { name: 'Game Controller', price: 4500, category: 'Gaming' },
]

export const categoryNames = ['Laptops', 'Mobiles', 'Accessories', 'Monitors', 'Gaming']
