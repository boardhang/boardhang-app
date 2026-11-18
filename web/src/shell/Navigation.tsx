// Bottom bar — thumb-reachable navigation for a phone at the wall. Search (the catalog)
// is ALWAYS the rightmost element.
//
// • Off the catalog the tabs cluster on the left, with a compact Search tab (icon over
//   label, styled like the tabs) pinned to the far right:
//   [Logbook] [Lists] [Settings] … [Search].
// • On the catalog the bar collapses to just the tab you came from plus the live search
//   field, which expands to fill the width: [origin] [search…]. The origin is the last
//   of Logbook / Lists / Settings visited (Logbook until one has been); the other tabs
//   are hidden until you leave the catalog.
//
// Boards have no tab: the board name in the header opens the boards drawer. A screen
// that belongs to no tab (the add and edit pages, the first-run page, the join route)
// passes `view="none"`, and nothing is highlighted.
//
// "Detail" is a sub-view of the catalog and keeps the same bar. Fully prop-driven: the
// search query and its writes are owned by the router-aware AppLayout, not this bar.

import { BookOpen, Bookmark, Search, Settings, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** A place the bar can go. */
export type NavTarget = 'catalog' | 'logbook' | 'lists' | 'settings'
/** The current screen: a target, or `none` for a screen that belongs to no tab. */
export type NavView = NavTarget | 'none'
/** A tab the catalog's collapsed bar can show. */
export type HomeTab = 'logbook' | 'lists' | 'settings'

interface NavigationProps {
  view: NavView
  onNavigate: (target: NavTarget) => void
  /** On the catalog, the one tab shown on the left: where the user came from. */
  origin?: HomeTab
  /** Targets that can't be reached yet (e.g. the catalog before a board is added). */
  disabled?: NavTarget[]
  /** Current search query (owned by AppLayout). */
  query: string
  onQueryChange: (query: string) => void
  onClear: () => void
}

export function Navigation({
  view,
  onNavigate,
  origin = 'logbook',
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
            {origin === 'lists' ? (
              <ListsTab active={false} onClick={() => onNavigate('lists')} />
            ) : origin === 'settings' ? (
              <SettingsTab active={false} onClick={() => onNavigate('settings')} />
            ) : (
              <LogbookTab active={false} onClick={() => onNavigate('logbook')} />
            )}
            <SearchField query={query} onQueryChange={onQueryChange} onClear={onClear} />
          </>
        ) : (
          // Other screens: the tabs left-clustered, the compact Search tab pinned right.
          <>
            <LogbookTab active={view === 'logbook'} onClick={() => onNavigate('logbook')} />
            <ListsTab active={view === 'lists'} onClick={() => onNavigate('lists')} />
            <SettingsTab active={view === 'settings'} onClick={() => onNavigate('settings')} />
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
    <div className="relative min-w-0 flex-1 py-2">
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

function SettingsTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <TabButton
      label="Settings"
      active={active}
      onClick={onClick}
      icon={<Settings className={cn('size-5', active && 'stroke-[2.5]')} />}
    />
  )
}

function ListsTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <TabButton
      label="Lists"
      active={active}
      onClick={onClick}
      icon={<Bookmark className={cn('size-5', active && 'fill-current stroke-[2.5]')} />}
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
