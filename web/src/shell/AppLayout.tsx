// The persistent app shell — the root route's chrome, rendered for every route:
// the account header, the routed <Outlet/>, and the bottom Navigation.
//
// The search field lives here (outside the routes) because it persists across the
// catalog's problem drawer and must survive board switches. This shell is the one
// router-aware seam (plan §6.4): it owns
//   • the debounced local-input → `?q` writer (replace, so typing doesn't stack history),
//   • the URL→input resync (Back / deep-link / board-switch change `?q` under us),
//   • which home tab the collapsed catalog nav shows (origin), and
//   • dropping a pending `?q` write when the board changes.
// Navigation itself stays fully prop-driven.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMatchRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AccountMenu } from '../auth/AccountMenu'
import { useBoardStore } from '../board/boardStore'
import { catalogNavTarget } from '../catalog/catalogNav'
import { Navigation, type NavView } from './Navigation'
import { Toaster } from '@/components/ui/sonner'
import { BleBrowserBanner } from './BleBrowserBanner'
import { InstallBanner } from './InstallBanner'
import { FullscreenTipBanner } from './FullscreenTipBanner'
import { SessionPill } from './SessionPill'
import { initSessions } from '../sessions/sessionsStore'
import { CATALOG_SEARCH_DEFAULTS, type CatalogSearch } from '../catalog/catalogSearch'

const Q_DEBOUNCE_MS = 250

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const { addedBoards, activeBoard } = useBoardStore()

  const catalogMatch = matchRoute({ to: '/board/$layoutId/catalog' })
  const onCatalog = catalogMatch !== false
  const layoutId = catalogMatch ? Number(catalogMatch.layoutId) : null

  // The current route's search (only the catalog route carries `q`).
  const search = useSearch({ strict: false }) as Partial<CatalogSearch>
  const urlQuery = onCatalog ? (search.q ?? '') : ''

  const onLists = matchRoute({ to: '/lists' }) !== false || matchRoute({ to: '/lists/$listId' }) !== false
  const view: NavView = onCatalog
    ? 'catalog'
    : matchRoute({ to: '/logbook' })
      ? 'logbook'
      : matchRoute({ to: '/settings' })
        ? 'settings'
        : onLists
          ? 'lists'
          : 'boards'

  // Rehydrate any active collaboration session once on app start (R11): restores the pill +
  // per-member chip selections from localStorage, retiring a locally-expired one (KTD-12).
  useEffect(() => {
    initSessions()
  }, [])

  // The home tab shown on the collapsed catalog nav — the last home screen visited.
  const [origin, setOrigin] = useState<'boards' | 'logbook' | 'settings'>('boards')
  useEffect(() => {
    if (view === 'boards' || view === 'logbook' || view === 'settings') setOrigin(view)
  }, [view])

  // ── Search field: local input + debounced write + resync ────────────────────
  const [field, setField] = useState(urlQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The last value WE pushed to `?q`. The resync effect only overwrites the input
  // when the URL's q differs from this — i.e. it changed via Back / deep-link /
  // board-switch, not via our own debounced write mid-typing.
  const lastPushed = useRef(urlQuery)
  const lastLayoutId = useRef(layoutId)

  // Resync the field to the URL whenever the URL's q changes out from under us
  // (Back / forward / deep-link), and always on a board switch — AppLayout is the
  // persistent root, so its `field` survives navigation and would otherwise strand a
  // half-typed query on the new board. In both cases drop any pending debounced
  // write, which is now stale (its target board/URL no longer applies); the
  // board-switch case is force-snapped even when q is unchanged (both '') so a typed
  // query left over from the old board can't linger unapplied.
  useEffect(() => {
    const boardChanged = lastLayoutId.current !== layoutId
    lastLayoutId.current = layoutId
    if (boardChanged || urlQuery !== lastPushed.current) {
      clearTimeout(debounceRef.current)
      setField(urlQuery)
      lastPushed.current = urlQuery
    }
  }, [urlQuery, layoutId])

  const writeQuery = (next: string, replace: boolean) => {
    if (layoutId === null) return
    lastPushed.current = next
    void navigate({
      to: '/board/$layoutId/catalog',
      params: { layoutId: String(layoutId) },
      // Merge over defaults: this navigate is unscoped, so `prev` is widened across
      // routes and may be sparse — the target route requires a full search.
      search: (prev) => ({ ...CATALOG_SEARCH_DEFAULTS, ...prev, q: next }),
      replace,
    })
  }

  const onQueryChange = (next: string) => {
    setField(next)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => writeQuery(next, true), Q_DEBOUNCE_MS)
  }

  const onClear = () => {
    setField('')
    clearTimeout(debounceRef.current)
    writeQuery('', true)
  }

  const go = (next: NavView) => {
    if (next === 'boards') void navigate({ to: '/boards' })
    else if (next === 'logbook') void navigate({ to: '/logbook' })
    else if (next === 'settings') void navigate({ to: '/settings' })
    else if (next === 'lists') void navigate({ to: '/lists' })
    else {
      // Search button → the active board's catalog (falls back to the MRU front).
      const board = addedBoards.some((b) => b.layoutId === activeBoard.layoutId)
        ? activeBoard
        : addedBoards[0]
      if (board) void navigate(catalogNavTarget(board))
    }
  }

  return (
    <div className="app-shell">
      <main className="app-scroll overflow-x-hidden">
        <BleBrowserBanner />
        <InstallBanner />
        <FullscreenTipBanner />
        <SessionPill suppressed={onCatalog} />
        <header className="mb-3 flex items-center justify-end gap-2">
          <AccountMenu />
        </header>
        {children}
      </main>
      <Navigation
        view={view}
        origin={origin}
        disabled={addedBoards.length === 0 ? ['catalog'] : []}
        query={field}
        onQueryChange={onQueryChange}
        onClear={onClear}
        onNavigate={go}
      />
      <Toaster position="bottom-center" />
    </div>
  )
}
