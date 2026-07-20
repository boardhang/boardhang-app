// The follow feed (U5) at /feed — the payoff surface. Reverse-chronological sends from the
// accounts you actively follow, read-only (no reactions in v1). All first-open states are
// enumerated so the headline screen is never an ambiguous blank: first-load skeleton,
// online-error with retry, offline-no-cache, offline/stale-with-cache banner, empty-graph
// (routes to discovery), and the populated list. Same-arrival bursts collapse (groupFeed) so a
// bulk logbook import can't bury everyone else.

import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FeedItem } from './FeedItem'
import { PersonAvatar } from './PersonAvatar'
import { groupFeed, type BurstEntry } from './feedGrouping'
import { loadFeed, loadMoreFeed, useFeed } from './feedStore'
import { relativeTime } from './relativeTime'

export function FeedScreen() {
  const feed = useFeed()

  useEffect(() => {
    void loadFeed()
  }, [])

  if (feed.status === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-2 p-4" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (feed.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load your feed.</p>
        <Button variant="outline" onClick={() => void loadFeed()}>
          Try again
        </Button>
      </div>
    )
  }

  if (feed.status === 'offline') {
    return (
      <p className="mx-auto w-full max-w-lg p-8 text-center text-sm text-muted-foreground">
        You're offline — connect to see your feed.
      </p>
    )
  }

  if (feed.sends.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 p-8 text-center">
        <p className="font-medium text-foreground">Your feed is quiet</p>
        <p className="text-sm text-muted-foreground">
          Follow some climbers to see what they’re sending.
        </p>
        <Button render={<Link to="/people" />}>Find people</Button>
      </div>
    )
  }

  const entries = groupFeed(feed.sends)
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col p-4">
      {feed.status === 'stale' && feed.fetchedAt && (
        <p className="pb-2 text-center text-xs text-muted-foreground">
          Offline — last updated {relativeTime(new Date(feed.fetchedAt).toISOString())}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((e) =>
          e.kind === 'single' ? (
            <li key={e.send.ascentId}>
              <FeedItem send={e.send} />
            </li>
          ) : (
            <li key={`burst-${e.actorId}-${e.firstSentAt}`}>
              <BurstRow entry={e} />
            </li>
          ),
        )}
      </ul>
      {!feed.done && (
        <Button
          variant="ghost"
          className="mt-2 self-center"
          disabled={feed.loadingMore}
          onClick={() => void loadMoreFeed()}
        >
          {feed.loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}

function BurstRow({ entry }: { entry: BurstEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PersonAvatar
          handle={entry.handle}
          displayName={entry.displayName}
          userId={entry.actorId}
          avatarUrl={entry.avatarUrl}
        />
        <p className="min-w-0 flex-1 truncate text-sm text-foreground">
          <span className="font-medium">@{entry.handle}</span> logged{' '}
          <span className="font-medium">{entry.sends.length} sends</span>
          <span className="text-muted-foreground"> · {relativeTime(entry.sends[0].climbedAt)}</span>
        </p>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="ml-11 flex flex-col divide-y divide-border border-l border-border pl-3">
          {entry.sends.map((s) => (
            <li key={s.ascentId}>
              <FeedItem send={s} hideAvatar />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
