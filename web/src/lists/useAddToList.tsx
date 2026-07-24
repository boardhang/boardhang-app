// The auth-gated "save to list" interaction, extracted from ProblemDetail so both the
// detail drawer and the catalog last-opened bar can reuse it without duplicating the
// signed-out sign-in-resume dance (KTD3): a signed-out "Save to list" tap opens the
// SignInDialog and remembers the intent; when the session lands, the sheet reopens on
// the same problem. Self-contained — owns its own SignInDialog + AddToListSheet — so a
// caller only wires `saveToList` to a button and renders `element`.

import { useEffect, useState, type ReactElement } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import type { CatalogBoardDef } from '../board/boards'
import type { CatalogProblem } from '../catalog/catalogSync'
import { AddToListSheet } from './AddToListSheet'

interface UseAddToListArgs {
  /** The problem being saved — rendered as a preview in the sheet and the source of its id. */
  problem: CatalogProblem
  board: CatalogBoardDef
}

interface UseAddToListResult {
  /** Trigger the flow: opens the sheet when signed in, else prompts sign-in (KTD3). */
  saveToList: () => void
  /** The SignInDialog + AddToListSheet to render once in the caller's tree. */
  element: ReactElement
}

export function useAddToList({ problem, board }: UseAddToListArgs): UseAddToListResult {
  const { status } = useAuth()
  const signedIn = status !== 'signedOut'
  const [open, setOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  // KTD3 resume: a signed-out tap remembers the intent so the sheet reopens once signed in.
  const [resume, setResume] = useState(false)

  function saveToList() {
    if (!signedIn) {
      setResume(true)
      setSignInOpen(true)
      return
    }
    setOpen(true)
  }

  // Once sign-in completes after a signed-out tap, resume by opening the sheet.
  useEffect(() => {
    if (signedIn && resume) {
      setResume(false)
      setOpen(true)
    }
  }, [signedIn, resume])

  const element = (
    <>
      <SignInDialog
        open={signInOpen}
        onOpenChange={(o) => {
          setSignInOpen(o)
          // Dialog dismissed WITHOUT a successful sign-in → drop the pending resume so a
          // later, unrelated sign-in never auto-opens the sheet on this problem.
          if (!o && !signedIn) setResume(false)
        }}
        title="Sign in to save to a list"
      />
      <AddToListSheet
        open={open}
        onOpenChange={setOpen}
        problem={problem}
        board={board}
      />
    </>
  )

  return { saveToList, element }
}
