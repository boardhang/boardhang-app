// Bottom bar — thumb-reachable navigation for a phone at the wall. Two items:
// a Boards tab and a detached Search (which also is the catalog entry — it's
// highlighted while the catalog is showing). Tapping Search lands on the catalog
// and morphs the bar into a search field (iOS search-role behavior). "Detail" is
// a sub-view of the catalog and has no tab.

import { Layers, Search, X } from 'lucide-react'
import { closeSearch, openSearch, setSearchQuery, useSearch } from '../catalog/searchStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type NavView = 'boards' | 'catalog'

interface NavigationProps {
  view: NavView
  onNavigate: (view: NavView) => void
  /** Views that can't be reached yet (e.g. Catalog before a board is added). */
  disabled?: NavView[]
}

export function Navigation({ view, onNavigate, disabled = [] }: NavigationProps) {
  const search = useSearch()
  const searchDisabled = disabled.includes('catalog') // search browses the catalog slab

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto max-w-md">
        {search.open ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={search.query}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name or setter"
                aria-label="Search problems"
                className="h-9 w-full rounded-md border border-input bg-input/30 pr-8 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {search.query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={closeSearch}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-6">
            <button
              type="button"
              aria-current={view === 'boards' ? 'page' : undefined}
              onClick={() => onNavigate('boards')}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-medium transition-colors',
                view === 'boards' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Layers className={cn('size-5', view === 'boards' && 'stroke-[2.5]')} />
              Boards
            </button>
            <button
              type="button"
              aria-label="Search"
              disabled={searchDisabled}
              aria-current={view === 'catalog' ? 'page' : undefined}
              onClick={() => {
                onNavigate('catalog')
                openSearch()
              }}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-medium transition-colors',
                view === 'catalog' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                searchDisabled && 'pointer-events-none opacity-35',
              )}
            >
              <Search className={cn('size-5', view === 'catalog' && 'stroke-[2.5]')} />
              Search
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
