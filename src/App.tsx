import { useState } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { HouseholdProvider } from './household/HouseholdProvider'
import { Header } from './components/Header'
import { TabNav } from './components/TabNav'
import { InvitePrompt } from './components/InvitePrompt'
import { HouseholdSettingsPage } from './pages/HouseholdSettingsPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { ShoppingPage } from './pages/ShoppingPage'
import { StockPage } from './pages/StockPage'
import type { TabId } from './types'
import './app.css'

function AppShell() {
  const [tab, setTab] = useState<TabId>('shop')
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="app">
      <Header onManageHousehold={() => setShowSettings(true)} />
      <main className="app__main">
        {showSettings ? (
          <HouseholdSettingsPage onClose={() => setShowSettings(false)} />
        ) : (
          <>
            {tab === 'shop' && <ShoppingPage />}
            {tab === 'stock' && <StockPage />}
            {tab === 'favourites' && <FavouritesPage />}
          </>
        )}
      </main>
      {!showSettings && <TabNav active={tab} onChange={setTab} />}
      <InvitePrompt />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <AppShell />
      </HouseholdProvider>
    </AuthProvider>
  )
}
