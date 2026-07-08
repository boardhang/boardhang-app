// A session member's avatar: the shadcn Avatar with an initials fallback (member avatar
// images are deferred repo-wide, so the fallback is all there is for now). One component for
// every member surface — the Filters-sheet rows, the catalog SessionBar, and the global
// SessionPill — so they stay visually identical. The self member gets a primary ring.

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function MemberAvatar({
  initials,
  isSelf,
  className,
  title,
}: {
  initials: string
  isSelf?: boolean
  className?: string
  /** Native hover tooltip (e.g. the member's name) for surfaces without their own tooltip. */
  title?: string
}) {
  return (
    <Avatar size="sm" title={title} className={className}>
      {/* Self marker is an INSET ring on the fallback — an outward ring/offset gets clipped by
          the surrounding overflow-y-auto scroll containers (which clip both axes). */}
      <AvatarFallback
        className={cn(
          'bg-primary/15 font-semibold text-foreground',
          isSelf && 'ring-2 ring-inset ring-primary',
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
