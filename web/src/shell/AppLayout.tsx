// The persistent app shell — the root route's chrome, rendered for every route:
// a pinned three-slot header (environment-banner slot / navbar with the account
// menu / optional SessionPill slot), the routed <Outlet/>, and the bottom
// Navigation. The header is a frosted `position: sticky` bar at the top of the
// scroll region, so content scrolls under it and blurs through; it lifts a shadow
// once scrolled.
//
// The search field lives here (outside the routes) because it persists across the
// catalog's problem drawer and must survive board switches. This shell is the one
// router-aware seam (plan §6.4): it owns
//   • the debounced local-input → `?q` writer (replace, so typing doesn't stack history),
//   • the URL→input resync (Back / deep-link / board-switch change `?q` under us),
//   • which home tab the collapsed catalog nav shows (origin), and
//   • dropping a pending `?q` write when the board changes.
// Navigation itself stays fully prop-driven.

import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { useMatchRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AccountMenu } from '../auth/AccountMenu'
import { BottomSlotContext } from './bottomSlot'
import { HeaderFilterSlotContext } from './headerFilterSlot'
import { useBoardStore } from '../board/boardStore'
import { catalogNavTarget } from '../catalog/catalogNav'
import { Navigation, type NavView } from './Navigation'
import { Toaster } from '@/components/ui/sonner'
import { BleBrowserBanner } from './BleBrowserBanner'
import { InstallBanner } from './InstallBanner'
import { FullscreenTipBanner } from './FullscreenTipBanner'
import { SessionPill } from './SessionPill'
import { PrivacyChoiceNotice } from '../social/PrivacyChoiceNotice'
import { initSessions, useSessions } from '../sessions/sessionsStore'
import { useSessionRealtime } from '../sessions/sessionRealtime'
import { PENDING_JOIN_KEY } from '../sessions/JoinSession'
import { useAuth } from '../auth/AuthProvider'
import { CATALOG_SEARCH_DEFAULTS, type CatalogSearch } from '../catalog/catalogSearch'
import { cn } from '@/lib/utils'

const Q_DEBOUNCE_MS = 250

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const { addedBoards, activeBoard } = useBoardStore()
  const { status: authStatus } = useAuth()

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

  // Keep the session's realtime channel subscribed app-wide whenever a session is active — so a
  // co-member's send refreshes the catalog and join/leave toasts fire on ANY screen, not just the
  // catalog. Keyed on the session id (the channel is per-session, not per-board); the board-scoped
  // ascents projection still lives in CatalogScreen and no-ops the refetch when it isn't mounted.
  const { activeSession } = useSessions()
  useSessionRealtime(activeSession?.id ?? null)

  // Resume a pending join after sign-in (U8): an OAuth round-trip returns to `/` and drops
  // the join route, so once a session lands we bounce back to /session/join/$token. The
  // on-page email-code flow keeps the route mounted and never needs this.
  useEffect(() => {
    if (authStatus === 'signedOut') return
    if (matchRoute({ to: '/session/join/$token' }) !== false) return
    let pending: string | null = null
    try {
      pending = sessionStorage.getItem(PENDING_JOIN_KEY)
    } catch {
      /* ignore */
    }
    if (pending) void navigate({ to: '/session/join/$token', params: { token: pending } })
  }, [authStatus, matchRoute, navigate])

  // The shell-owned mount point above the nav (see bottomSlot). A ref-callback into
  // state so consumers re-render once the element commits and can portal into it.
  const [bottomSlot, setBottomSlot] = useState<HTMLDivElement | null>(null)
  const [headerFilterSlot, setHeaderFilterSlot] = useState<HTMLDivElement | null>(null)

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

  // Lift a shadow under the pinned header once the content has scrolled, so it
  // reads as chrome floating over moving content (flat at rest). Only flip state
  // on the threshold crossing, not on every scroll frame.
  const [scrolled, setScrolled] = useState(false)
  const onScroll = (e: UIEvent<HTMLElement>) => {
    const next = e.currentTarget.scrollTop > 4
    setScrolled((prev) => (prev === next ? prev : next))
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
    <BottomSlotContext.Provider value={bottomSlot}>
      <HeaderFilterSlotContext.Provider value={headerFilterSlot}>
      <div className="app-shell">
        <main className="app-scroll overflow-x-hidden" onScroll={onScroll}>
          <header
            className={cn(
              // Frosted glass: a translucent background + backdrop blur so the
              // content scrolling underneath shows through, dimmed and blurred like
              // a modal scrim. A hairline border and a scroll-lifted shadow seat it.
              'app-header border-b border-border bg-background/50 backdrop-blur-md transition-shadow',
              scrolled && 'shadow-sm',
            )}
          >
            {/* Top slot — the environment banners. They self-gate; when all null the
                slot collapses (`.app-header-slot:empty`), and multiple stack with a
                gap. Today's env banners are mutually exclusive in real environments,
                so normally one shows. */}
            <div className="app-header-slot">
              <BleBrowserBanner />
              <InstallBanner />
              <FullscreenTipBanner />
            </div>
            {/* Navbar — avatar / login, right-aligned. */}
            <div className="flex items-center justify-end gap-2">
              <AccountMenu />
            </div>
            {/* Bottom slot — the collab SessionPill when a session is active, except
                on the catalog where SessionBar owns that surface. Collapses when empty. */}
            <div className="app-header-slot">
              <SessionPill suppressed={onCatalog} />
            </div>
            {/* Filter-pill slot — the catalog portals its FilterPillBar here via
                HeaderFilterSlotContext (mirrors the bottom slot). Empty on every other
                route ⇒ collapses. */}
            <div ref={setHeaderFilterSlot} className="app-header-slot" />
          </header>
          {children}
        </main>
        {/* Mount point above the nav for route-owned chrome (the catalog last-opened
            bar). Empty ⇒ zero-height auto grid row, so it costs nothing when unused.
            min-w-0 + overflow-x-hidden: as a grid item it defaults to min-width:auto,
            which would let long, unbreakable content (a long problem name) grow the
            shell past the viewport; this pins it to the column width so the bar's
            `truncate` produces an ellipsis exactly like the catalog rows. */}
        <div ref={setBottomSlot} className="min-w-0 overflow-x-hidden" />
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
        {/* One-time public/private notice for existing users (self-gates on privacyChoiceAt). */}
        <PrivacyChoiceNotice />
      </div>
      </HeaderFilterSlotContext.Provider>
    </BottomSlotContext.Provider>
  )
}
