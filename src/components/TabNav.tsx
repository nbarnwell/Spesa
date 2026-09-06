import type { TabId } from '../types'

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'shop', label: 'Shop', icon: '🛒' },
  { id: 'stock', label: 'Stock', icon: '🏠' },
  { id: 'favourites', label: 'Faves', icon: '⭐' },
]

interface TabNavProps {
  active: TabId
  onChange: (tab: TabId) => void
}

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav className="tab-nav" aria-label="Main">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-nav__btn ${active === tab.id ? 'tab-nav__btn--active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          <span className="tab-nav__icon" aria-hidden>
            {tab.icon}
          </span>
          <span className="tab-nav__label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
