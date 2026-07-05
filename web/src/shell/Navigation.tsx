// Bottom tab bar — thumb-reachable navigation for a phone at the wall. "Detail"
// is a sub-view of the catalog and has no tab.

import { Blocks, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NavView = 'boards' | 'catalog'

const TABS: { view: NavView; label: string; Icon: typeof Blocks }[] = [
  { view: 'catalog', label: 'Catalog', Icon: Blocks },
  { view: 'boards', label: 'Boards', Icon: Layers },
]

interface NavigationProps {
  view: NavView
  onNavigate: (view: NavView) => void
  /** Views that can't be reached yet (e.g. Catalog before a board is added). */
  disabled?: NavView[]
}

export function Navigation({ view, onNavigate, disabled = [] }: NavigationProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ view: v, label, Icon }) => {
          const active = view === v
          const isDisabled = disabled.includes(v)
          return (
            <button
              key={v}
              type="button"
              disabled={isDisabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(v)}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[0.7rem] font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                isDisabled && 'pointer-events-none opacity-35',
              )}
            >
              <Icon className={cn('size-5', active && 'stroke-[2.5]')} />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
