import { useState } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { Header } from './components/Header'
import { TabNav } from './components/TabNav'
import { FavouritesPage } from './pages/FavouritesPage'
import { ShoppingPage } from './pages/ShoppingPage'
import { StockPage } from './pages/StockPage'
import type { TabId } from './types'
import './app.css'

function AppShell() {
  const [tab, setTab] = useState<TabId>('shop')

  return (
    <div className="app">
      <Header />
      <main className="app__main">
        {tab === 'shop' && <ShoppingPage />}
        {tab === 'stock' && <StockPage />}
        {tab === 'favourites' && <FavouritesPage />}
      </main>
      <TabNav active={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
