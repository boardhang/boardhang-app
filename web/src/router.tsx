// Client-side route tree for the PWA (code-based, no file-route codegen).
//
// The URL is the sole source of truth for every explicit route — localStorage is
// consulted only to build the bare-`/` redirect on a cold launch (see
// `catalogNavTarget`). History routing gives clean, shareable URLs; the deploy
// host serves index.html for unknown paths (vite PWA navigateFallback).
//
//   /                        → redirect: no boards → /boards, else last catalog
//   /boards                  → FirstBoard (first-run page); with boards → redirect to /
//   /boards/add              → AddBoardPick  (add a board, step 1: which board)
//   /boards/add/$layoutId    → AddBoardSetup (step 2: angle and hold sets)
//   /boards/$layoutId/edit   → EditBoard     (angle, hold sets, remove)
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
  type RouterHistory,
} from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'
import { FirstBoard } from './boards/FirstBoard'
import { AddBoardPick } from './boards/AddBoardPick'
import { AddBoardSetupRoute, EditBoardRoute } from './boards/boardRoutes'
import { SettingsScreen } from './shell/SettingsScreen'
import { LogbookScreen } from './logbook/LogbookScreen'
import { ImportFromMoonBoardScreen } from './logbook/ImportFromMoonBoardScreen'
import { ListsScreen } from './lists/ListsScreen'
import { ListDetailScreen } from './lists/ListDetailScreen'
import { CatalogScreen } from './catalog/CatalogScreen'
import { JoinSession } from './sessions/JoinSession'
import { boardByLayoutId } from './board/boards'
import { getActiveBoardId, getAddedBoardIds } from './board/boardStore'
import { catalogNavTarget } from './catalog/catalogNav'
import { CATALOG_SEARCH_DEFAULTS, validateCatalogSearch } from './catalog/catalogSearch'
import { LOGBOOK_SEARCH_DEFAULTS, validateLogbookSearch } from './logbook/logbookSearch'
import { IMPORT_SEARCH_DEFAULTS, validateImportSearch } from './logbook/importSearch'

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
      const added = getAddedBoardIds()
      if (added.length === 0) throw redirect({ to: '/boards' })
      // Prefer the active board when it's actually added, else the MRU front.
      const activeId = getActiveBoardId()
      const targetId = added.includes(activeId) ? activeId : added[0]
      throw redirect(catalogNavTarget(boardByLayoutId(targetId)!))
    },
  })

  // The first-run page. With a board added there is nothing to show here, so it sends
  // on to `/` (the active board's catalog) — which also keeps every "fall back to
  // /boards" caller landing somewhere useful.
  const boardsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/boards',
    beforeLoad: () => {
      if (getAddedBoardIds().length > 0) throw redirect({ to: '/' })
    },
    component: FirstBoard,
  })

  const addBoardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/boards/add',
    component: AddBoardPick,
  })

  const addBoardSetupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/boards/add/$layoutId',
    beforeLoad: ({ params }) => {
      const id = Number(params.layoutId)
      if (boardByLayoutId(id) === undefined) throw redirect({ to: '/boards/add' })
      // Already added: there is nothing to add, so open its edit page instead.
      if (getAddedBoardIds().includes(id)) {
        throw redirect({ to: '/boards/$layoutId/edit', params })
      }
    },
    component: AddBoardSetupRoute,
  })

  const editBoardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/boards/$layoutId/edit',
    beforeLoad: ({ params }) => {
      // Not added (or not a board at all): the add flow sorts out which.
      if (!getAddedBoardIds().includes(Number(params.layoutId))) {
        throw redirect({ to: '/boards/add/$layoutId', params })
      }
    },
    component: EditBoardRoute,
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
    // A different board or angle is a different slab, so the screen starts fresh. Without
    // this an in-place switch (a tile tapped in the boards drawer, browser Back between
    // two boards' catalogs) renders once with the previous slab's loaded problems under
    // the new board, and effects that wait for "loaded" act on the wrong data.
    remountDeps: ({ params, search }) => ({ layoutId: params.layoutId, angle: search.angle }),
    beforeLoad: ({ params }) => {
      // Unknown board (not in the registry) → bounce to /boards, which lands on the
      // active board's catalog or the first-run page. A registry-valid
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
    addBoardRoute,
    addBoardSetupRoute,
    editBoardRoute,
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
