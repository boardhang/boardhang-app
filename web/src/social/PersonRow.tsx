// A reusable person row: avatar + identity (linking to /u/:handle) + the RelationshipButton.
// Shared by search results, co-member suggestions, and the follow-back list (U4).

import { Link } from '@tanstack/react-router'
import { PersonAvatar } from './PersonAvatar'
import { RelationshipButton } from './RelationshipButton'
import type { ProfileCard } from './socialTypes'

export function PersonRow({ card }: { card: ProfileCard }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Link
        to="/u/$handle"
        params={{ handle: card.handle }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PersonAvatar
          handle={card.handle}
          displayName={card.displayName}
          userId={card.id}
          avatarUrl={card.avatarUrl}
        />
        <div className="min-w-0">
          {card.displayName.trim() && (
            <p className="truncate font-medium text-foreground">{card.displayName}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">@{card.handle}</p>
        </div>
      </Link>
      <RelationshipButton target={card} />
    </div>
  )
}
