// Bottom bar — thumb-reachable navigation for a phone at the wall. Search (the catalog)
// is ALWAYS the rightmost element.
//
// • On a home screen (Boards / Logbook) both home tabs show clustered on the left, with a
//   compact Search tab (icon over label, styled like the home tabs) pinned to the far
//   right: [Boards] [Logbook] … [Search].
// • On the catalog, the bar collapses to just the tab you came from plus the live search
//   field that expands to fill the width: [origin] [search…]. Only the origin (the last
//   home screen visited before searching) is shown — the other home tab is hidden until
//   you leave the catalog.
//
// "Detail" is a sub-view of the catalog and keeps the same bar. Fully prop-driven: the
// search query and its writes are owned by the router-aware AppLayout, not this bar.

import { BookOpen, Layers, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type NavView = 'boards' | 'catalog' | 'logbook'
type HomeView = 'boards' | 'logbook'

interface NavigationProps {
  view: NavView
  onNavigate: (view: NavView) => void
  /** On the catalog, the home tab to show on the left — where the user came from. */
  origin?: HomeView
  /** Views that can't be reached yet (e.g. Catalog before a board is added). */
  disabled?: NavView[]
  /** Current search query (owned by AppLayout). */
  query: string
  onQueryChange: (query: string) => void
  onClear: () => void
}

export function Navigation({
  view,
  onNavigate,
  origin = 'boards',
  disabled = [],
  query,
  onQueryChange,
  onClear,
}: NavigationProps) {
  const searchDisabled = disabled.includes('catalog') // search browses the catalog slab

  return (
    <nav
      aria-label="Primary"
      className="border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center gap-2 px-3">
        {view === 'catalog' ? (
          // Collapsed: only the origin tab, then the live search field (rightmost).
          <>
            {origin === 'boards' ? (
              <BoardsTab active={false} onClick={() => onNavigate('boards')} />
            ) : (
              <LogbookTab active={false} onClick={() => onNavigate('logbook')} />
            )}
            <SearchField query={query} onQueryChange={onQueryChange} onClear={onClear} />
          </>
        ) : (
          // Home screens: both tabs left-clustered, the compact Search tab pinned right.
          <>
            <BoardsTab active={view === 'boards'} onClick={() => onNavigate('boards')} />
            <LogbookTab active={view === 'logbook'} onClick={() => onNavigate('logbook')} />
            <TabButton
              label="Search"
              className="ml-auto"
              active={false}
              disabled={searchDisabled}
              title={searchDisabled ? 'Add a board first' : undefined}
              onClick={() => onNavigate('catalog')}
              icon={<Search className="size-5" />}
            />
          </>
        )}
      </div>
    </nav>
  )
}

function SearchField({
  query,
  onQueryChange,
  onClear,
}: {
  query: string
  onQueryChange: (query: string) => void
  onClear: () => void
}) {
  return (
    <div className="relative flex-1 py-2">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Name or setter"
        aria-label="Search problems"
        className="h-9 rounded-md pr-8 pl-9 text-base md:text-sm"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="absolute top-1/2 right-2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

function BoardsTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <TabButton
      label="Boards"
      active={active}
      onClick={onClick}
      icon={<Layers className={cn('size-5', active && 'stroke-[2.5]')} />}
    />
  )
}

function LogbookTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <TabButton
      label="Logbook"
      active={active}
      onClick={onClick}
      icon={<BookOpen className={cn('size-5', active && 'stroke-[2.5]')} />}
    />
  )
}

function TabButton({
  label,
  icon,
  active,
  onClick,
  disabled = false,
  title,
  className,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[0.7rem] font-medium transition-colors',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-35',
        className,
      )}
    >
      {icon}
      {label}
    </button>
  )
}
