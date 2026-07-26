// Client-side route tree for the PWA (code-based, no file-route codegen).
//
// The URL is the sole source of truth for every explicit route — localStorage is
// consulted only to build the bare-`/` redirect on a cold launch (see
// `catalogNavTarget`). History routing gives clean, shareable URLs; the deploy
// host serves index.html for unknown paths (vite PWA navigateFallback).
//
//   /                        → redirect: no boards → /boards, else last catalog
//   /boards                  → MyBoards (global, not board-scoped)
//   /logbook                 → LogbookScreen
//   /logbook/import          → ImportFromMoonBoardScreen (guided GDPR data request)
//   /lists                   → ListsScreen  (Saved Lists index; requires sign-in)
//   /lists/$listId           → ListDetailScreen
//   /settings                → SettingsScreen (global; appearance/theme)
//   /board/$layoutId/catalog → CatalogScreen  (search params: see catalogSearch.ts)
//
// The tree is built by a factory so tests can spin up an isolated memory-history
// router without reusing route objects already bound to the browser router.

import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  stripSearchParams,
  useNavigate,
  type RouterHistory,
} from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'
import { MyBoards } from './shell/MyBoards'
import { SettingsScreen } from './shell/SettingsScreen'
import { LogbookScreen } from './logbook/LogbookScreen'
import { ImportFromMoonBoardScreen } from './logbook/ImportFromMoonBoardScreen'
import { ListsScreen } from './lists/ListsScreen'
import { ListDetailScreen } from './lists/ListDetailScreen'
import { CatalogScreen } from './catalog/CatalogScreen'
import { JoinSession } from './sessions/JoinSession'
import { boardByLayoutId } from './board/boards'
import { getActiveInstanceId, getAddedInstanceIds, instanceById } from './board/boardStore'
import { catalogNavTarget } from './catalog/catalogNav'
import { CATALOG_SEARCH_DEFAULTS, validateCatalogSearch } from './catalog/catalogSearch'
import { LOGBOOK_SEARCH_DEFAULTS, validateLogbookSearch } from './logbook/logbookSearch'
import { IMPORT_SEARCH_DEFAULTS, validateImportSearch } from './logbook/importSearch'

function BoardsRoute() {
  const navigate = useNavigate()
  return (
    <MyBoards
      onActivated={(instanceId) => {
        const instance = instanceById(instanceId)
        if (instance) void navigate(catalogNavTarget(instance))
      }}
    />
  )
}

function buildRouteTree() {
  const rootRoute = createRootRoute({
    component: () => (
      <AppLayout>
        <Outlet />
      </AppLayout>
    ),
  })

  // Bare `/` — the only place localStorage seeds a route. Cold launch lands here.
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      const added = getAddedInstanceIds()
      if (added.length === 0) throw redirect({ to: '/boards' })
      // Prefer the active instance when it's actually held, else the MRU front. Resolve
      // through the store rather than the registry: an adopted instance's id carries no
      // layout, so `boardByLayoutId(id)` has nothing to look up and a non-null assertion
      // there would crash cold launch outright instead of degrading.
      const activeId = getActiveInstanceId()
      const targetId = added.includes(activeId) ? activeId : added[0]
      const target = instanceById(targetId)
      if (target === undefined) throw redirect({ to: '/boards' })
      throw redirect(catalogNavTarget(target))
    },
  })

  const boardsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/boards',
    component: BoardsRoute,
  })

  const logbookRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/logbook',
    validateSearch: validateLogbookSearch,
    search: { middlewares: [stripSearchParams(LOGBOOK_SEARCH_DEFAULTS)] },
    component: LogbookScreen,
  })

  const logbookImportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/logbook/import',
    validateSearch: validateImportSearch,
    search: { middlewares: [stripSearchParams(IMPORT_SEARCH_DEFAULTS)] },
    component: ImportFromMoonBoardScreen,
  })

  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsScreen,
  })

  const listsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/lists',
    component: ListsScreen,
  })

  const listDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/lists/$listId',
    component: ListDetailScreen,
  })

  const catalogRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/board/$layoutId/catalog',
    validateSearch: validateCatalogSearch,
    search: { middlewares: [stripSearchParams(CATALOG_SEARCH_DEFAULTS)] },
    beforeLoad: ({ params }) => {
      // Unknown board (not in the registry) → bounce to My Boards. A registry-valid
      // but un-added board is allowed through: the screen shows a read-only preview
      // with an "Add this board" affordance (plan §3).
      if (boardByLayoutId(Number(params.layoutId)) === undefined) {
        throw redirect({ to: '/boards' })
      }
    },
    component: CatalogScreen,
  })

  // Join-by-link: sign in (if needed) → consent → join → land in the board catalog (U8).
  const joinSessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/join/$token',
    component: JoinSession,
  })

  return rootRoute.addChildren([
    indexRoute,
    boardsRoute,
    logbookRoute,
    logbookImportRoute,
    settingsRoute,
    listsRoute,
    listDetailRoute,
    catalogRoute,
    joinSessionRoute,
  ])
}

/** Build a router over a fresh route tree. `history` is omitted in the browser
 *  (defaults to history routing) and supplied as memory history in tests. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree: buildRouteTree(), history })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
