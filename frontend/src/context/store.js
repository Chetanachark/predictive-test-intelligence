import { createContext, useContext } from 'react'
export const StoreContext = createContext(null)
export function useStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('StoreProvider is required.')
  return store
}
