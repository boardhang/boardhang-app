// Notifications (U6) at /notifications — two sections:
//   • Requests: pending follow requests with Approve / Decline (respond_to_follow).
//   • Activity: new-follower / request-accepted rows, marked read on view.
// Read-only beyond approve/decline; no OS push in v1.

import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PersonAvatar } from './PersonAvatar'
import { relativeTime } from './relativeTime'
import {
  loadNotifications,
  markActivityRead,
  resolveRequest,
  useNotifications,
} from './notificationsStore'
import type { FollowRequest, NotificationItem } from './socialTypes'

export function NotificationsScreen() {
  const { status, requests, activity } = useNotifications()

  useEffect(() => {
    void loadNotifications().then(() => void markActivityRead())
  }, [])

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-2 p-4" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
        <Button variant="outline" onClick={() => void loadNotifications()}>
          Try again
        </Button>
      </div>
    )
  }

  if (requests.length === 0 && activity.length === 0) {
    return (
      <p className="mx-auto w-full max-w-lg p-8 text-center text-sm text-muted-foreground">
        No notifications yet.
      </p>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 p-4">
      {requests.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">Requests</h2>
          <ul className="flex flex-col divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id}>
                <RequestRow request={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {activity.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">Activity</h2>
          <ul className="flex flex-col divide-y divide-border">
            {activity.map((a) => (
              <li key={a.id}>
                <ActivityRow item={a} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function RequestRow({ request }: { request: FollowRequest }) {
  async function resolve(accept: boolean) {
    try {
      await resolveRequest(request.id, accept)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't update the request.")
    }
  }
  return (
    <div className="flex items-center gap-3 py-2">
      <Link
        to="/u/$handle"
        params={{ handle: request.handle }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PersonAvatar {...request} userId={request.id} />
        <div className="min-w-0">
          {request.displayName.trim() && (
            <p className="truncate font-medium text-foreground">{request.displayName}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">
            @{request.handle} · wants to follow you
          </p>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => void resolve(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => void resolve(false)}>
          Decline
        </Button>
      </div>
    </div>
  )
}

function ActivityRow({ item }: { item: NotificationItem }) {
  const verb = item.type === 'follow' ? 'started following you' : 'accepted your follow request'
  return (
    <Link
      to="/u/$handle"
      params={{ handle: item.handle }}
      className="flex items-center gap-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PersonAvatar {...item} userId={item.actorId} />
      <p className="min-w-0 flex-1 truncate text-sm text-foreground">
        <span className="font-medium">@{item.handle}</span> {verb}
      </p>
      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
    </Link>
  )
}
