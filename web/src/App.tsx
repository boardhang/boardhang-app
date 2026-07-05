import { useEffect, useRef, useState } from 'react'
import './App.css'
import { AccountMenu } from './auth/AccountMenu'
import { useBoardStore } from './board/boardStore'
import { CatalogScreen } from './catalog/CatalogScreen'
import { clearSearch } from './catalog/searchStore'
import { MyBoards } from './shell/MyBoards'
import { Navigation, type NavView } from './shell/Navigation'

function App() {
  const { addedBoards, activeBoard } = useBoardStore()
  const [view, setView] = useState<NavView>('catalog')

  // Search is transient per board — switching the active board must not carry a
  // stale query onto a different board's catalog.
  const lastBoardId = useRef(activeBoard.layoutId)
  useEffect(() => {
    if (lastBoardId.current !== activeBoard.layoutId) {
      clearSearch()
      lastBoardId.current = activeBoard.layoutId
    }
  }, [activeBoard.layoutId])

  // First-run / no active board: the catalog has no slab to browse, so route to
  // My Boards to add one rather than showing an empty catalog.
  const effectiveView: NavView = addedBoards.length === 0 && view === 'catalog' ? 'boards' : view

  const noBoards = addedBoards.length === 0

  return (
    <div className="app-shell">
      <main className="app-scroll overflow-x-hidden">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold tracking-tight">MoonBoard LED</h1>
          <AccountMenu />
        </header>
        {effectiveView === 'catalog' && <CatalogScreen />}
        {effectiveView === 'boards' && <MyBoards onActivated={() => setView('catalog')} />}
      </main>
      <Navigation view={effectiveView} onNavigate={setView} disabled={noBoards ? ['catalog'] : []} />
    </div>
  )
}

export default App
