// A session member's avatar: the shadcn Avatar with the member's photo when set, else an
// initials fallback. One component for every member surface — the Filters-sheet rows, the
// catalog SessionBar, and the global SessionPill — so they stay visually identical. The
// self member gets a primary ring. `AvatarImage` transparently falls back to the initials
// when `avatarUrl` is null/undefined or the image fails to load.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function MemberAvatar({
  initials,
  avatarUrl,
  isSelf,
  className,
  title,
  size = 'sm',
}: {
  initials: string
  /** Public avatar URL, or null/undefined to show initials. */
  avatarUrl?: string | null
  isSelf?: boolean
  className?: string
  /** Native hover tooltip (e.g. the member's name) for surfaces without their own tooltip. */
  title?: string
  /** Avatar preset — defaults to `sm` (the roster/filter size); the sends pill uses `xxs`. */
  size?: 'default' | 'sm' | 'lg' | 'xs' | 'xxs'
}) {
  return (
    <Avatar size={size} title={title} className={cn('bg-background', className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      {/* Self marker is an INSET ring on the fallback — an outward ring/offset gets clipped by
          the surrounding overflow-y-auto scroll containers (which clip both axes). The fallback
          tint is translucent (bg-primary/15), so the Avatar root carries an opaque bg-background
          base — otherwise, in an overlapping group, a neighbour avatar shows through the tint. */}
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
