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
    <Avatar
      size="sm"
      title={title}
      className={cn(isSelf && 'ring-1 ring-primary ring-offset-1 ring-offset-background', className)}
    >
      <AvatarFallback className="bg-primary/15 font-semibold text-foreground">{initials}</AvatarFallback>
    </Avatar>
  )
}
