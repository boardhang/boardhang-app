// The edit page for one board: its picture, angle and hold sets, then "Remove board".
// Each change is written to the board store at once — there is nothing to save, so
// leaving by any route keeps what was changed. Editing a board does not make it active.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import {
  SessionExitError,
  endActiveSessionLocally,
  exitSessionOnBoard,
  useSessions,
} from '../sessions/sessionsStore'
import { Button } from '@/components/ui/button'
import { markAngleEdited } from './angleEdited'
import { BoardSetupFields } from './BoardSetupFields'
import { useGoBack } from './useGoBack'

export function EditBoard({ board }: { board: CatalogBoardDef }) {
  const navigate = useNavigate()
  const back = useGoBack()
  // Subscribes this page to the store, so the values read below follow each write.
  const { removeBoard, setAngle, setActiveHoldSetsRaw } = useBoardStore()
  const { activeSession } = useSessions()
  const hasActiveSession = activeSession?.boardLayoutId === board.layoutId

  const [confirming, setConfirming] = useState(false)
  const removeRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Move focus with the swap: the button that was pressed is gone, so without this
  // focus falls to the page body and a keyboard or screen-reader user loses their place.
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
    else if (wasConfirming.current) removeRef.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  // Removing a board you're mid-session on drops you out of that session too — you can't be
  // on a wall you just said you don't have. The board is local state and goes FIRST: the exit
  // is a network call with no timeout, so awaiting it would leave a stalled connection holding
  // the page open with nothing happening. `exitSessionOnBoard` reads only the sessions store,
  // so it is unaffected by the board list changing under it.
  function handleRemove() {
    removeBoard(board.layoutId)
    void exitSessionOnBoard(board.layoutId)
      .then((exit) => {
        if (exit === 'ended') toast(`Ended your session on ${board.name}`)
        else if (exit === 'left') toast(`Left the session on ${board.name}`)
      })
      .catch((e: unknown) => {
        // This device is out either way; what differs is what is still true on the server, so
        // say that instead of asserting "offline" for what may be any failure.
        console.error('Could not exit the session on the removed board', e)
        endActiveSessionLocally()
        const endFailed = e instanceof SessionExitError && e.intent === 'ended'
        toast(endFailed ? 'Couldn’t end the session yet' : 'Left the session on this device', {
          description: endFailed
            ? 'It’s still running and its invite link still works — we’ll finish ending it next time you’re online.'
            : 'The others may still see you until we finish this next time you’re online.',
        })
      })
    // `/` lands on the next board's catalog, or on the first-run page when none is left.
    void navigate({ to: '/', replace: true })
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={back}>
          <ArrowLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">Edit {board.name}</h1>
      </div>

      <BoardSetupFields
        board={board}
        angle={getAngle(board)}
        holdSetsRaw={getActiveHoldSetsRaw(board.layoutId)}
        onAngle={(angle) => {
          setAngle(board.layoutId, angle)
          markAngleEdited(board.layoutId)
        }}
        onHoldSetsRaw={(raw) => setActiveHoldSetsRaw(board.layoutId, raw)}
      />

      <div className="space-y-3 border-t pt-4">
        {confirming ? (
          <>
            <p className="text-sm text-muted-foreground">
              {hasActiveSession
                ? 'You are in a live session on this board. Removing it takes you out of the session.'
                : 'Remove this board from your boards? Your logbook and lists are kept.'}
            </p>
            <div className="flex gap-2">
              <Button ref={cancelRef} variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleRemove}>
                Remove board
              </Button>
            </div>
          </>
        ) : (
          <Button
            ref={removeRef}
            variant="outline"
            className="w-full text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
            Remove board
          </Button>
        )}
      </div>
    </div>
  )
}
