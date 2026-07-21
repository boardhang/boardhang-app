// Discovery (U4) — the three paths that seed the follow graph from data already in the DB, so
// the feed can populate: handle search, co-member suggestions (people you share a list/session
// with), and follow-back (your non-reciprocated followers). All reuse PersonRow +
// RelationshipButton, so there is no new social plumbing.
//
// Search states are enumerated (design review #14) so a short/empty/no-match query never leaves
// a blank screen: below-minimum → a hint; in-flight → a spinner line; no results → an explicit
// empty state; results → the list. When the query is empty, the two suggestion sections show.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PersonRow } from './PersonRow'
import { seedEdge } from './followStore'
import {
  cardFromRow,
  searchResultFromRow,
  type ProfileCard,
  type ProfileCardRow,
  type SearchResultRow,
} from './socialTypes'

const MIN_QUERY = 2
const DEBOUNCE_MS = 300

type SearchState =
  | { kind: 'idle' } // query below minimum
  | { kind: 'loading' }
  | { kind: 'results'; cards: ProfileCard[] }
  | { kind: 'error' }

export function DiscoverScreen() {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const searching = trimmed.length >= MIN_QUERY

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
      <Input
        type="search"
        placeholder="Search by name or @handle"
        aria-label="Search for people"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-base md:text-sm"
      />
      {searching ? (
        <SearchResults query={trimmed} />
      ) : (
        <>
          {query.trim().length > 0 && (
            <p className="text-sm text-muted-foreground">Type at least {MIN_QUERY} characters.</p>
          )}
          <CoMembers />
          <FollowBack />
        </>
      )}
    </div>
  )
}

function SearchResults({ query }: { query: string }) {
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const reqId = useRef(0)

  useEffect(() => {
    const id = ++reqId.current
    setState({ kind: 'loading' })
    const timer = setTimeout(async () => {
      if (!supabase) {
        if (id === reqId.current) setState({ kind: 'results', cards: [] })
        return
      }
      const { data, error } = await supabase.rpc('search_profiles', { p_q: query })
      if (id !== reqId.current) return
      if (error) {
        setState({ kind: 'error' })
        return
      }
      const rows = (data ?? []) as SearchResultRow[]
      const cards = rows.map(searchResultFromRow)
      // Prime each result's edge so the button renders the right label immediately.
      for (const r of cards) seedEdge(r.id, r.edgeStatus)
      setState({ kind: 'results', cards })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  if (state.kind === 'loading') {
    return <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
  }
  if (state.kind === 'error') {
    return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't search right now.</p>
  }
  if (state.kind === 'results' && state.cards.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No one found.</p>
  }
  if (state.kind === 'results') {
    return (
      <ul className="flex flex-col divide-y divide-border">
        {state.cards.map((c) => (
          <li key={c.id}>
            <PersonRow card={c} />
          </li>
        ))}
      </ul>
    )
  }
  return null
}

/** A suggestion section: fetches a card list once and renders it under a heading (or nothing). */
function Section({
  title,
  fetcher,
}: {
  title: string
  fetcher: () => Promise<ProfileCard[] | null>
}) {
  const [cards, setCards] = useState<ProfileCard[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    void fetcher().then((c) => {
      if (!live) return
      setCards(c)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [fetcher])

  if (loading) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Skeleton className="h-12 w-full" />
      </section>
    )
  }
  if (!cards || cards.length === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {cards.map((c) => (
          <li key={c.id}>
            <PersonRow card={c} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function CoMembers() {
  const fetcher = useCallback(async () => {
    if (!supabase) return []
    const { data, error } = await supabase.rpc('suggest_co_members', {})
    if (error) return null
    return ((data ?? []) as ProfileCardRow[]).map(cardFromRow)
  }, [])
  return <Section title="People you climb with" fetcher={fetcher} />
}

function FollowBack() {
  const { profile } = useAuth()
  const me = profile?.id
  const fetcher = useCallback(async () => {
    if (!supabase || !me) return []
    // Followers minus those I already follow = non-reciprocated followers.
    const [followers, following] = await Promise.all([
      supabase.rpc('get_follow_list', { p_target: me, p_kind: 'followers' }),
      supabase.rpc('get_follow_list', { p_target: me, p_kind: 'following' }),
    ])
    if (followers.error || following.error) return null
    const followingIds = new Set(((following.data ?? []) as ProfileCardRow[]).map((r) => r.id))
    return ((followers.data ?? []) as ProfileCardRow[])
      .filter((r) => !followingIds.has(r.id))
      .map(cardFromRow)
  }, [me])
  return <Section title="Follow back" fetcher={fetcher} />
}
