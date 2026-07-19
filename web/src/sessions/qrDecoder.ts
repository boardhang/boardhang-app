// The dynamic-import boundary for the in-app QR scanner. Everything heavy — the
// @yudiel/react-qr-scanner wrapper and the ~433 kB zxing-wasm reader binary — lives behind this
// module so it loads only when the scanner drawer opens (KTD-5, the app's first dynamic import).
//
// The reader WASM is self-hosted (KTD-2): ensureDecoder hands prepareZXingModule the Vite-bundled
// asset URL (resolved through the hoisted transitive zxing-wasm copy) instead of letting it fetch
// from jsDelivr. WASM prep is a *retryable* runtime step, not a top-level await — a top-level await
// would put the whole module record into a permanently-errored state on an offline fetch, so no
// later retry could ever recover it. Instead the memo clears itself on failure, so once the network
// returns a fresh ensureDecoder() call re-attempts and the scanner recovers (KTD-3/KTD-5).

import { Scanner, prepareZXingModule } from '@yudiel/react-qr-scanner'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

let readyPromise: Promise<unknown> | null = null

/** Prepare the self-hosted reader WASM, memoized across scanner opens. A failed attempt clears the
 *  memo so the next call retries rather than replaying a cached rejection. */
export function ensureDecoder(): Promise<unknown> {
  if (!readyPromise) {
    readyPromise = prepareZXingModule({
      overrides: {
        locateFile: (filePath: string, prefix: string) =>
          filePath.endsWith('.wasm') ? wasmUrl : prefix + filePath,
      },
      fireImmediately: true,
    }).catch((err) => {
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

export default Scanner
export { Scanner }
