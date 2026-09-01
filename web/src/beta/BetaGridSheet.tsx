import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import type { BetaVideo } from './betaTypes'
import { BetaCard, PendingCard } from './BetaCard'
import { useHistoryBackClose } from './useHistoryBackClose'

interface BetaGridSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videos: BetaVideo[]
  /** Mirror the strip's local pending-review placeholder ahead of the real cards. */
  pending: boolean
  /** Open the player for a tapped clip. The sheet stays open underneath so the back
   *  gesture unwinds player → grid → problem drawer. */
  onOpen: (v: BetaVideo) => void
  /** Same action as the strip's header button — the sign-in gate stays in BetaVideos. */
  onAddBeta: () => void
}

/**
 * "View all" surface for a problem's beta clips: a bottom sheet with a fluid grid of
 * the same cards the strip shows, opened from the strip's "+N" count tile.
 */
export function BetaGridSheet({ open, onOpenChange, videos, pending, onOpen, onAddBeta }: BetaGridSheetProps) {
  useHistoryBackClose(open, () => onOpenChange(false), 'betaGrid')

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent aria-label="All beta videos">
        <DrawerHeader className="flex flex-row items-center justify-between">
          <div className="flex items-baseline gap-2">
            <DrawerTitle>Beta videos</DrawerTitle>
            <span className="text-sm tabular-nums text-muted-foreground">{videos.length}</span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1" onClick={onAddBeta}>
            <Plus className="size-3.5" />
            Add a beta
          </Button>
        </DrawerHeader>
        <div className="grid max-h-[calc(100dvh-10rem)] grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {pending && <PendingCard className="w-full" />}
          {videos.map((v) => (
            <BetaCard key={v.id} video={v} onOpen={onOpen} className="w-full" />
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
