import { toast } from 'sonner'

/**
 * Wrap a retryable async action as a sonner toast-action onClick. The primary failure a
 * Retry exists for is offline/5xx, so the retried op often rejects AGAIN — a bare
 * `void fn()` would drop that rejection (unhandled promise rejection) AND leave the user
 * with no feedback that the retry failed. This surfaces the second failure as its own
 * toast, mirroring how the remove-Undo action already guards itself.
 */
export function retryAction(fn: () => Promise<unknown>): () => void {
  return () =>
    void fn().catch((e) =>
      toast.error('Retry failed. Please try again.', {
        description: e instanceof Error ? e.message : undefined,
      }),
    )
}
