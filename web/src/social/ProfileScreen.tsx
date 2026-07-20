// A user's profile at /u/:handle (R18/R19). Resolves the card through get_profile_card (by
// handle, block-aware) — an empty result renders the "unavailable" state, which covers both a
// blocked pair (R11: the blocker's profile appears absent, and the viewer is never told why)
// and a non-existent handle, deliberately indistinguishable.
//
// For another user: header (avatar, name, @handle, follower/following counts) + the
// RelationshipButton + a block overflow (confirm-gated). For your own handle: header + your
// sends, no follow/block affordances.

import { useEffect, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PersonAvatar } from './PersonAvatar'
import { RelationshipButton } from './RelationshipButton'
import { UserSendsList } from './UserSendsList'
import { block, loadEdge, unblock, useEdge } from './followStore'
import { cardFromRow, type ProfileCard, type ProfileCardRow } from './socialTypes'

interface Counts {
  followers: number
  following: number
}

type CardState = 'loading' | 'ready' | 'unavailable'

export function ProfileScreen() {
  const { handle } = useParams({ strict: false }) as { handle?: string }
  const { profile: me } = useAuth()

  const [card, setCard] = useState<ProfileCard | null>(null)
  const [state, setState] = useState<CardState>('loading')
  const [counts, setCounts] = useState<Counts | null>(null)

  useEffect(() => {
    let live = true
    setState('loading')
    setCard(null)
    setCounts(null)
    if (!supabase || !handle) {
      setState('unavailable')
      return
    }
    void (async () => {
      const { data, error } = await supabase.rpc('get_profile_card', { p_handle: handle })
      if (!live) return
      const row = ((data ?? []) as ProfileCardRow[])[0]
      if (error || !row) {
        setState('unavailable')
        return
      }
      const c = cardFromRow(row)
      setCard(c)
      setState('ready')
      // The viewer's edge (drives the button) and the target's public counts.
      void loadEdge(c.id)
      const { data: countData } = await supabase.rpc('get_follow_counts', { p_target: c.id })
      if (!live) return
      const cr = ((countData ?? []) as { followers: number; following: number }[])[0]
      setCounts(cr ? { followers: Number(cr.followers), following: Number(cr.following) } : null)
    })()
    return () => {
      live = false
    }
  }, [handle])

  if (state === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (state === 'unavailable' || !card) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-2 p-8 text-center">
        <p className="font-medium text-foreground">This account is unavailable</p>
        <p className="text-sm text-muted-foreground">
          The profile doesn’t exist, or you can’t view it.
        </p>
      </div>
    )
  }

  const isSelf = me?.id === card.id
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
      <ProfileHeader card={card} counts={counts} isSelf={isSelf} />
      <UserSendsList userId={card.id} />
    </div>
  )
}

function ProfileHeader({
  card,
  counts,
  isSelf,
}: {
  card: ProfileCard
  counts: Counts | null
  isSelf: boolean
}) {
  const edge = useEdge(card.id)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <PersonAvatar
          handle={card.handle}
          displayName={card.displayName}
          userId={card.id}
          avatarUrl={card.avatarUrl}
          size="lg"
          className="size-16"
        />
        <div className="min-w-0 flex-1">
          {card.displayName.trim() && (
            <p className="truncate font-semibold text-foreground">{card.displayName}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">@{card.handle}</p>
          {counts && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{counts.followers}</span> followers ·{' '}
              <span className="font-medium text-foreground">{counts.following}</span> following
            </p>
          )}
        </div>
      </div>

      {!isSelf && (
        <div className="flex items-center gap-2">
          {edge.blocked ? (
            <BlockedControls card={card} />
          ) : (
            <>
              <RelationshipButton target={card} />
              <BlockOverflow card={card} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BlockedControls({ card }: { card: ProfileCard }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">You blocked @{card.handle}.</span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void unblock(card.id)
            .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't unblock."))
            .finally(() => setBusy(false))
        }}
      >
        Unblock
      </Button>
    </div>
  )
}

function BlockOverflow({ card }: { card: ProfileCard }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={`More options for @${card.handle}`} />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            Block @{card.handle}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block @{card.handle}?</DialogTitle>
            <DialogDescription>
              They won’t be able to follow you or see your climbs, and you won’t see theirs. Any
              follows between you are removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void block(card.id)
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't block."))
                  .finally(() => {
                    setBusy(false)
                    setConfirming(false)
                  })
              }}
            >
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
