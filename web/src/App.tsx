import { useState } from 'react'
import './App.css'
import { useBoardStore } from './board/boardStore'
import { CatalogScreen } from './catalog/CatalogScreen'
import { MyBoards } from './shell/MyBoards'
import { Navigation, type NavView } from './shell/Navigation'

function App() {
  const { addedBoards } = useBoardStore()
  const [view, setView] = useState<NavView>('catalog')

  // First-run / no active board: the catalog has no slab to browse, so route to
  // My Boards to add one rather than showing an empty catalog.
  const effectiveView: NavView = addedBoards.length === 0 && view === 'catalog' ? 'boards' : view

  const noBoards = addedBoards.length === 0

  return (
    <div className="app pb-24">
      <header className="mb-3">
        <h1 className="text-base font-semibold tracking-tight">MoonBoard LED</h1>
      </header>
      {effectiveView === 'catalog' && <CatalogScreen />}
      {effectiveView === 'boards' && <MyBoards onActivated={() => setView('catalog')} />}
      <Navigation view={effectiveView} onNavigate={setView} disabled={noBoards ? ['catalog'] : []} />
    </div>
  )
}

export default App
