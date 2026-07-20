// A user's sends on their profile (R19) — the projection is get_user_sends (single-actor
// wrapper over the revoked _sends_for_actors core). The server applies the R6/R12 gate: a
// blocked pair or an effectively-private non-follower gets an empty set, which renders here as
// the gated empty state (indistinguishable from "no sends yet", by design — a private account
// must not leak whether it has activity).
//
// One fetch feeds three sections: the latest climbing session, a grade histogram, and the full
// keyset-paged list. All three derive from the accumulated sends, so "Load more" grows the
// histogram too. Read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardByLayoutId } from '../board/boards'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GradePyramid } from '../logbook/GradePyramid'
import type { PyramidInput } from '../logbook/sessions'
import { relativeTime } from './relativeTime'
import { fetchSendsPage, SENDS_PAGE } from './sendsPage'
import { latestSession, type SessionCluster } from './profileStats'
import type { SendItem } from './socialTypes'

/** Map profile sends to the pyramid's minimal shape — projection sends are all `sent`. */
function toPyramidInput(sends: SendItem[]): PyramidInput[] {
  return sends.map((s) => ({
    sent: true,
    sourceCatalogId: s.sourceCatalogId,
    problemName: s.problemName,
    problemGrade: s.problemGrade,
    date: s.climbedAt,
    tries: s.tries,
  }))
}

type LoadState = 'loading' | 'loaded' | 'error'

const sessionDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

export function ProfileSends({ userId }: { userId: string }) {
  const [sends, setSends] = useState<SendItem[]>([])
  const [status, setStatus] = useState<LoadState>('loading')
  const [done, setDone] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Guards against a stale response overwriting a newer userId's list.
  const reqId = useRef(0)

  const fetchPage = useCallback(
    (cursor: SendItem | null) => fetchSendsPage('get_user_sends', cursor, { p_target: userId }),
    [userId],
  )

  useEffect(() => {
    const id = ++reqId.current
    setSends([])
    setStatus('loading')
    setDone(false)
    void fetchPage(null).then((rows) => {
      if (id !== reqId.current) return
      if (rows === null) {
        setStatus('error')
        return
      }
      setSends(rows)
      setStatus('loaded')
      setDone(rows.length < SENDS_PAGE)
    })
  }, [fetchPage])

  async function loadMore() {
    const cursor = sends[sends.length - 1]
    if (!cursor) return
    const id = reqId.current
    setLoadingMore(true)
    const rows = await fetchPage(cursor)
    setLoadingMore(false)
    if (id !== reqId.current || rows === null) return
    setSends((prev) => [...prev, ...rows])
    setDone(rows.length < SENDS_PAGE)
  }

  const session = useMemo(() => latestSession(sends), [sends])
  const pyramidInput = useMemo(() => toPyramidInput(sends), [sends])

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (status === 'error') {
    return <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load sends.</p>
  }

  if (sends.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No sends to show.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {session && <LatestSessionCard session={session} />}
      <section>
        <h2 className="px-1 pb-2 text-sm font-semibold text-foreground">Grades</h2>
        <GradePyramid items={pyramidInput} />
      </section>
      <div className="flex flex-col">
        <p className="px-1 pb-2 text-sm font-medium text-muted-foreground">
          All sends
          <span className="text-muted-foreground/70">
            {' · '}
            {sends.length}
            {done ? '' : '+'}
          </span>
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {sends.map((s) => (
            <SendRow key={s.ascentId} send={s} />
          ))}
        </ul>
        {!done && (
          <Button variant="ghost" className="mt-2 self-center" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  )
}

function LatestSessionCard({ session }: { session: SessionCluster }) {
  const count = session.sends.length
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between pb-2">
        <h2 className="text-sm font-semibold text-foreground">Latest session</h2>
        <span className="text-xs text-muted-foreground">
          {sessionDate.format(session.date)} · {count} climb{count === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {session.sends.map((s) => (
          <SendRow key={s.ascentId} send={s} />
        ))}
      </ul>
    </section>
  )
}

function SendRow({ send }: { send: SendItem }) {
  const board = boardByLayoutId(send.boardLayoutId)
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{send.problemName}</p>
        <p className="truncate text-sm text-muted-foreground">
          {send.problemGrade}
          {board ? ` · ${board.name}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(send.climbedAt)}</span>
    </li>
  )
}
