import { useState } from 'react'
import './App.css'
import { useBoardStore } from './board/boardStore'
import { CatalogScreen } from './catalog/CatalogScreen'
import { BuildScreen } from './shell/BuildScreen'
import { MyBoards } from './shell/MyBoards'
import { Navigation, type NavView } from './shell/Navigation'

function App() {
  const { addedBoards } = useBoardStore()
  const [view, setView] = useState<NavView>('catalog')

  // First-run / no active board: the catalog has no slab to browse, so route to
  // My Boards to add one rather than showing an empty catalog.
  const effectiveView: NavView = addedBoards.length === 0 && view === 'catalog' ? 'boards' : view

  return (
    <div className="app">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">MoonBoard LED</h1>
        <Navigation view={effectiveView} onNavigate={setView} />
      </header>
      {effectiveView === 'catalog' && <CatalogScreen />}
      {effectiveView === 'boards' && <MyBoards onActivated={() => setView('catalog')} />}
      {effectiveView === 'build' && <BuildScreen />}
    </div>
  )
}

export default App
