// Bottom bar — thumb-reachable navigation for a phone at the wall. Right slot is
// always Boards; the left slot is the live search field while the catalog is
// showing, or a Search button (→ catalog, no autofocus) while on Boards. The
// field is always present on the catalog — no morph, no Cancel. "Detail" is a
// sub-view of the catalog and keeps the same bar.

import { Layers, Search, X } from 'lucide-react'
import { clearSearch, setSearchQuery, useSearchQuery } from '../catalog/searchStore'
import { cn } from '@/lib/utils'

export type NavView = 'boards' | 'catalog'

interface NavigationProps {
  view: NavView
  onNavigate: (view: NavView) => void
  /** Views that can't be reached yet (e.g. Catalog before a board is added). */
  disabled?: NavView[]
}

export function Navigation({ view, onNavigate, disabled = [] }: NavigationProps) {
  const query = useSearchQuery()
  const searchDisabled = disabled.includes('catalog') // search browses the catalog slab

  return (
    <nav
      aria-label="Primary"
      className="border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      {/* Full-width: Boards pinned left, search always pinned to the right edge. */}
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          aria-current={view === 'boards' ? 'page' : undefined}
          onClick={() => onNavigate('boards')}
          className={cn(
            'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.7rem] font-medium transition-colors',
            view === 'boards' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Layers className={cn('size-5', view === 'boards' && 'stroke-[2.5]')} />
          Boards
        </button>
        {view === 'catalog' ? (
          <div className="relative flex-1 py-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name or setter"
              aria-label="Search problems"
              className="h-9 w-full rounded-md border border-input bg-input/30 pr-8 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clearSearch}
                className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            aria-label="Search"
            disabled={searchDisabled}
            title={searchDisabled ? 'Add a board first' : undefined}
            onClick={() => onNavigate('catalog')}
            className={cn(
              'ml-auto flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.7rem] font-medium transition-colors',
              'text-muted-foreground hover:text-foreground',
              searchDisabled && 'opacity-35',
            )}
          >
            <Search className="size-5" />
            Search
          </button>
        )}
      </div>
    </nav>
  )
}
