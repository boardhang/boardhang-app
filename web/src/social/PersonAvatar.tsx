// The social avatar — a person's photo with an initials fallback. Extracted because the same
// Avatar + AvatarImage + AvatarFallback(memberInitials) block was copy-pasted across PersonRow,
// ProfileScreen, FeedItem, the feed BurstRow, and the notifications rows.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { memberInitials } from '../sessions/sessionsTypes'

export function PersonAvatar({
  handle,
  displayName,
  userId,
  avatarUrl,
  size = 'sm',
  className,
}: {
  handle: string
  displayName: string
  userId: string
  avatarUrl: string | null
  size?: 'sm' | 'lg'
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback
        className={cn('bg-primary/15 font-semibold text-foreground', size === 'lg' && 'text-lg')}
      >
        {memberInitials({ displayName, handle, userId })}
      </AvatarFallback>
    </Avatar>
  )
}
