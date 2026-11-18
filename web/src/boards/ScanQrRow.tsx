// The "Scan a QR code" row: joins a session a friend started. Shown in the boards
// drawer and on the first-run page. `ScanToJoinButton` owns the scan dialog, so this
// is only the row's look.

import { ChevronRight, ScanQrCode } from 'lucide-react'
import { ScanToJoinButton } from '../sessions/ScanToJoin'

export function ScanQrRow() {
  return (
    <ScanToJoinButton
      variant="outline"
      className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal"
    >
      <ScanQrCode className="size-5 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Scan a QR code</span>
        <span className="block text-xs text-muted-foreground">Join a session a friend started</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </ScanToJoinButton>
  )
}
