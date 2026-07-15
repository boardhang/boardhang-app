// The dynamic-import boundary for the in-app QR scanner. Everything heavy — the
// @yudiel/react-qr-scanner wrapper and the ~433 kB zxing-wasm reader binary — lives behind this
// module so it loads only when the scanner drawer opens (KTD-5, the app's first dynamic import).
//
// The reader WASM is self-hosted (KTD-2): we hand prepareZXingModule the Vite-bundled asset URL
// (resolved through the hoisted transitive zxing-wasm copy) instead of letting it fetch from
// jsDelivr. The top-level await gates this module's resolution on the WASM being ready, so an
// offline or failed WASM fetch rejects THIS import (KTD-3) — routing to the paste fallback via the
// consumer's error boundary rather than leaving a live viewfinder that silently never decodes.

import { Scanner, prepareZXingModule } from '@yudiel/react-qr-scanner'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

await prepareZXingModule({
  overrides: {
    locateFile: (filePath: string, prefix: string) =>
      filePath.endsWith('.wasm') ? wasmUrl : prefix + filePath,
  },
  fireImmediately: true,
})

// Default export so a React.lazy boundary consumes it directly; tests mock this module with a fake
// Scanner exposing the same onScan prop.
export default Scanner
export { Scanner }
