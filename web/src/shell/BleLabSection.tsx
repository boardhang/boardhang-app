// Settings section, admin-only (SettingsScreen gates it on `useAuth().isAdmin`): the
// BLE lab. Switches the shared Bluetooth client onto its experimental path on THIS
// device, exposes the picker and write-mode knobs, offers quick actions against the
// board, and shows the diagnostics log with a Copy button so a dark wall at a gym can
// be explained after the fact. See docs/ble-hardware.md ("BLE lab").
//
// Every setting change disconnects the board first: the client snapshots the lab
// settings per connect attempt, so a live link never changes behaviour under the
// admin's feet, and the next tap opens the chooser again.

import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { bleClient, connectBoard, disconnectBoard, useBle } from '../ble/useBle'
import { describeBleError } from '../ble/moonboard'
import {
  clearBleDiagnostics,
  formatBleDiagnostics,
  updateBleLinkSummary,
  useBleDiagnostics,
  type BleLinkSummary,
} from '../ble/bleDiagnostics'
import {
  getLabSettings,
  setLabSettings,
  useLabSettings,
  type LabChooser,
  type LabSettings,
  type LabWriteMode,
} from '../ble/labSettings'

const CHOOSER_OPTIONS: { value: LabChooser; label: string }[] = [
  { value: 'nordic', label: 'Nordic only' },
  { value: 'both', label: 'Both types' },
  { value: 'any', label: 'Any device' },
]

const WRITE_MODE_OPTIONS: { value: LabWriteMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'with-response', label: 'Acknowledged' },
  { value: 'without-response', label: 'Unacknowledged' },
]

/** Disconnect first (a no-op without a device), then persist the change. */
function applySetting(patch: Partial<LabSettings>): void {
  disconnectBoard()
  setLabSettings(patch)
}

function describeProperties(link: BleLinkSummary): string {
  const p = link.properties
  if (p === null) return 'unknown'
  if (typeof p === 'string') return p
  if (!p.present) return 'absent'
  return `write=${p.write} writeWithoutResponse=${p.writeWithoutResponse} notify=${p.notify}`
}

function describeMode(link: BleLinkSummary): string {
  if (!link.writeMode) return 'none'
  if (link.writer === 'legacy') {
    return `${link.writeMode}${link.forced ? ' forced' : ''} (legacy writeValue, type chosen by the browser)`
  }
  return `${link.writeMode}${link.forced ? ' forced' : ''}`
}

function eventTime(t: number): string {
  return new Date(t).toISOString().slice(11, 23)
}

export function BleLabSection() {
  const settings = useLabSettings()
  const ble = useBle()
  const diag = useBleDiagnostics()
  const [busy, setBusy] = useState<'connect' | 'send' | null>(null)
  const [showText, setShowText] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const connected = ble.state === 'connected'
  const sendDisabled = !connected || busy !== null

  async function handleConnect() {
    setBusy('connect')
    try {
      const failure = await connectBoard()
      if (failure) {
        toast.error(
          failure.raw !== failure.message ? `${failure.message} [${failure.raw}]` : failure.message,
        )
      }
    } finally {
      setBusy(null)
    }
  }

  async function runAction(label: string, chunks: number, action: () => Promise<void>) {
    setBusy('send')
    try {
      await action()
      updateBleLinkSummary({
        lastAction: `${label} sent, ${chunks} chunk${chunks === 1 ? '' : 's'}, ${bleClient.writeMode ?? 'unknown mode'}`,
      })
    } catch (err) {
      const message = describeBleError(err)
      updateBleLinkSummary({ lastAction: `${label} failed: ${message}` })
      toast.error(message)
    } finally {
      setBusy(null)
    }
  }

  async function handleCopy() {
    const text = formatBleDiagnostics(getLabSettings())
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Diagnostics copied')
    } catch {
      setShowText(true)
      toast.error("Couldn't copy — the text is shown below, select it by hand")
    }
  }

  const statusLine =
    ble.state === 'connected'
      ? `Connected to ${ble.deviceName ?? 'board'}`
      : ble.state === 'connecting'
        ? 'Connecting…'
        : 'Disconnected'

  const events = [...diag.events].reverse()

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">BLE lab</h2>
            <Badge variant="outline">Experimental</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Experimental Bluetooth path for older MoonBoard LED boxes, on this device only.
            Changing a setting disconnects the board.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Use the experimental path</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Off = today's Bluetooth behaviour. On = pick both controller types and choose the
              write type from the box.
            </div>
          </div>
          <Switch
            aria-label="Use the experimental Bluetooth path"
            checked={settings.enabled}
            onCheckedChange={(checked) => applySetting({ enabled: checked })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Device picker</div>
          <ToggleGroup
            aria-label="Device picker"
            variant="outline"
            spacing={0}
            value={[settings.chooser]}
            disabled={!settings.enabled}
            onValueChange={(value) => {
              const next = value[0] as LabChooser | undefined
              if (next && next !== getLabSettings().chooser) applySetting({ chooser: next })
            }}
            className="w-full"
          >
            {CHOOSER_OPTIONS.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value} className="flex-1" disabled={!settings.enabled}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Nordic only is today's picker. Both types adds the original MoonBoard box. Any device
            lists everything nearby, but the log can only show the two known services — an
            unknown box needs an nRF Connect capture.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Write mode</div>
          <ToggleGroup
            aria-label="Write mode"
            variant="outline"
            spacing={0}
            value={[settings.writeMode]}
            disabled={!settings.enabled}
            onValueChange={(value) => {
              const next = value[0] as LabWriteMode | undefined
              if (next && next !== getLabSettings().writeMode) applySetting({ writeMode: next })
            }}
            className="w-full"
          >
            {WRITE_MODE_OPTIONS.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value} className="flex-1" disabled={!settings.enabled}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Auto picks the write type from the box. Acknowledged = write with response;
            Unacknowledged = write without response.
          </p>
        </div>

        <div className="rounded-md border p-3 text-xs" aria-live="polite">
          <div className="text-sm font-medium">{statusLine}</div>
          {diag.link ? (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
              <dt>Controller</dt>
              <dd>{diag.link.controller ?? 'none'}</dd>
              <dt>Write mode</dt>
              <dd>{describeMode(diag.link)}</dd>
              <dt>Properties</dt>
              <dd className="break-words">{describeProperties(diag.link)}</dd>
              <dt>Last action</dt>
              <dd className="break-words">{diag.link.lastAction ?? '—'}</dd>
            </dl>
          ) : (
            <div className="mt-1 text-muted-foreground">No link.</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={ble.state === 'connecting' || busy !== null}
            onClick={() => void handleConnect()}
          >
            Connect
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sendDisabled}
            onClick={() => void runAction('Light LED 0', 1, () => bleClient.lightLed(0))}
          >
            Light LED 0
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sendDisabled}
            onClick={() => void runAction('Clear LEDs', 1, () => bleClient.clear())}
          >
            Clear LEDs
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ble.state === 'disconnected'}
            onClick={() => disconnectBoard()}
          >
            Disconnect
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Log</div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No events yet. Connect to record one.</p>
          ) : (
            <ol
              aria-label="Bluetooth events, newest first"
              className="max-h-64 overflow-y-auto rounded-md border p-2 font-mono text-xs leading-5 break-words"
            >
              {events.map((e, i) => (
                <li key={`${e.t}-${i}`}>
                  <span className="text-muted-foreground">{eventTime(e.t)}</span> {e.kind}
                  {e.detail !== undefined ? ` ${e.detail}` : ''}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
              Copy diagnostics
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={showText}
              onClick={() => setShowText((v) => !v)}
            >
              {showText ? 'Hide text' : 'Show as text'}
            </Button>
          </div>
          {showText && (
            <Textarea
              readOnly
              aria-label="Diagnostics as text"
              className="font-mono text-xs"
              rows={8}
              value={formatBleDiagnostics(settings)}
            />
          )}
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
              Clear log
            </Button>
          </div>
        </div>

        <Dialog open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Clear the Bluetooth log?</DialogTitle>
              <DialogDescription>
                The log is the only record of what the board did. Copy it first if you want to
                keep it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  clearBleDiagnostics()
                  setConfirmClear(false)
                }}
              >
                Clear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
