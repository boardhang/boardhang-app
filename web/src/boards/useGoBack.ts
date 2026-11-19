// The back arrow on the add and edit pages: back in history, so the page returns to
// wherever it was opened from. A deep link has nothing behind it, so it goes to the
// fallback instead: `/` by default, which lands on the active board's catalog (or the
// first-run page).

import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'

export function useGoBack(fallback: '/' | '/boards/add' = '/'): () => void {
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  return () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: fallback, replace: true })
  }
}
