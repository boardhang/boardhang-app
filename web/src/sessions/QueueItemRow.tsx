// One row of the session queue drawer (U4). Presentational: the parent QueueDrawer owns the
// store mutations, toasts, and the aria-live announcements; this row just renders the climb and
// wires its controls to callbacks. An `active` row carries a drag handle (a placeholder element
// U5 wires the touch-reorder gesture to — see useDragReorder), up/down move controls (the
// pointer/keyboard reorder path, KTD7), a check-off toggle, and a remove control. A `done` row
// carries an un-check control (back to active) and remove. The sent-marker reuses the catalog
// "sends pill" (a green check + sender avatars, keyed on source_catalog_id — KTD6).

import { CheckCircle2, ChevronDown, ChevronUp, GripVertical, RotateCcw, X } from 'lucide-react'
import type { CatalogProblem } from '../catalog/catalogSync'
import type { SenderChip } from '../catalog/useMemberSenders'
import type { QueueItem } from './queueTypes'
import { MemberAvatar } from './MemberAvatar'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Max sender avatars in the pill before the +K overflow count (mirrors CatalogRow). */
const SENDER_CAP = 3

/** "Sent by You, Bob, +2" — the accessible summary for the sends pill (role=img). */
function sendersAriaLabel(senders: SenderChip[]): string {
  const shown = senders.slice(0, SENDER_CAP).map((s) => s.label)
  const extra = senders.length - shown.length
  return `Sent by ${[...shown, ...(extra > 0 ? [`+${extra}`] : [])].join(', ')}`
}

export interface QueueItemRowProps {
  item: QueueItem
  /** Resolved catalog problem (title + grade), or undefined until the id lookup lands. */
  problem?: CatalogProblem
  /** Crew members (self first) who have sent this problem — the sends pill (KTD6). */
  senders?: SenderChip[]
  variant: 'active' | 'done'
  /** Position among active items — drives the up/down disabled ends. Active rows only. */
  index?: number
  total?: number
  /** Close the drawer + open this problem via the shared ?problem navigation (KTD9). */
  onOpen: () => void
  onCheckOff?: () => void
  onUnCheck?: () => void
  onRemove?: () => void
  onMove?: (dir: -1 | 1) => void
  /** U5 drag state: this row is the one being dragged — it lifts and follows the finger. */
  isDragging?: boolean
  /** Live vertical translate for the dragged row (px); ignored unless `isDragging`. */
  dragOffsetY?: number
  /** Show the drop indicator above this row — it marks where a dragged row will land. */
  showDropIndicator?: boolean
}

export function QueueItemRow({
  item,
  problem,
  senders,
  variant,
  index = 0,
  total = 1,
  onOpen,
  onCheckOff,
  onUnCheck,
  onRemove,
  onMove,
  isDragging = false,
  dragOffsetY = 0,
  showDropIndicator = false,
}: QueueItemRowProps) {
  const name = problem?.name ?? 'this climb'
  const isDone = variant === 'done'

  return (
    <li
      style={isDragging ? { transform: `translateY(${dragOffsetY}px)` } : undefined}
      className={cn(
        'flex items-center gap-1 border-b border-border/50 py-1.5',
        isDone && 'opacity-70',
        // The row currently in the drop slot carries a top accent marking where the drag lands.
        showDropIndicator && 'border-t-2 border-t-primary',
        // The dragged row lifts above the list and follows the finger (no snap-back transition).
        isDragging && 'relative z-10 rounded-md bg-background shadow-lg',
      )}
    >
      {variant === 'active' && (
        // Drag handle placeholder. U5 (useDragReorder) attaches the touch-drag gesture to the
        // `data-queue-drag-handle` element; until then it is inert and aria-hidden, and the
        // up/down controls below are the reachable reorder path for pointer/keyboard/AT (KTD7).
        <span
          data-queue-drag-handle
          data-item-id={item.id}
          aria-hidden
          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/50"
      >
        <span className="flex w-full items-center gap-1.5">
          <span className={cn('truncate text-sm font-semibold tracking-tight uppercase', isDone && 'line-through')}>
            {name}
          </span>
          {problem && (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-bold tabular-nums text-secondary-foreground">
              {problem.grade}
            </span>
          )}
        </span>
        {senders && senders.length > 0 && (
          <span
            role="img"
            aria-label={sendersAriaLabel(senders)}
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-2 pl-1.5"
          >
            <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-success" />
            <AvatarGroup className="-space-x-1.5">
              {senders.slice(0, SENDER_CAP).map((s) => (
                <MemberAvatar
                  key={s.userId}
                  initials={s.initials}
                  avatarUrl={s.avatarUrl}
                  isSelf={s.isSelf}
                  title={s.label}
                  size="xxs"
                  opaque
                />
              ))}
              {senders.length > SENDER_CAP && <AvatarGroupCount>+{senders.length - SENDER_CAP}</AvatarGroupCount>}
            </AvatarGroup>
          </span>
        )}
      </button>

      {variant === 'active' ? (
        <div className="flex shrink-0 items-center">
          <div className="flex flex-col">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${name} up`}
              disabled={index <= 0}
              onClick={() => onMove?.(-1)}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${name} down`}
              disabled={index >= total - 1}
              onClick={() => onMove?.(1)}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-success"
            aria-label={`Mark ${name} done`}
            onClick={onCheckOff}
          >
            <CheckCircle2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Remove ${name} from the queue`}
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Move ${name} back to the queue`}
            onClick={onUnCheck}
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Remove ${name} from the queue`}
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </li>
  )
}
