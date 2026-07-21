// Settings — global, non-board-scoped app configuration. Reached from the bottom
// nav's Settings tab (`/settings`). Holds Appearance (theme) and per-surface climb
// preview toggles; laid out as labeled Card rows so more settings can slot in later.

import { useState } from 'react'
import { ChevronRight, Download, Monitor, Moon, Sun } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  setShowPreviews,
  useShowPreviews,
  type PreviewSurface,
} from '../catalog/previewsStore'
import { useAuth } from '../auth/AuthProvider'
import { setTheme, useTheme, type Theme } from './themeStore'

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const PREVIEW_OPTIONS: { surface: PreviewSurface; label: string; detail: string }[] = [
  { surface: 'catalog', label: 'Catalog', detail: 'Rows in the problem catalog and recents.' },
  { surface: 'logbook', label: 'Logbook', detail: 'Rows in your logbook sessions.' },
  { surface: 'lists', label: 'Lists', detail: 'Rows inside a list.' },
  {
    surface: 'lastOpened',
    label: 'Last opened bar',
    detail: 'The latest-problem bar above the bottom navigation.',
  },
]

function PreviewToggleRow({ surface, label, detail }: (typeof PREVIEW_OPTIONS)[number]) {
  const on = useShowPreviews(surface)
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      </div>
      <Switch
        aria-label={`Show climb previews in ${label.toLowerCase()}`}
        checked={on}
        onCheckedChange={(checked) => setShowPreviews(surface, checked)}
      />
    </div>
  )
}

function PrivacyCard() {
  const { status, profile, setPrivacyChoice } = useAuth()
  const [saving, setSaving] = useState(false)
  if (status !== 'signedInWithProfile' || !profile) return null
  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Privacy</h2>
          <p className="text-sm text-muted-foreground">
            Control who can follow you and see your climbs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Private account</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              You approve each follower before they see your climbs.
            </div>
          </div>
          <Switch
            aria-label="Private account"
            checked={profile.isPrivate}
            disabled={saving}
            onCheckedChange={(checked) => {
              setSaving(true)
              void setPrivacyChoice(checked)
                .catch(() => toast.error("Couldn't update your privacy setting."))
                .finally(() => setSaving(false))
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsScreen() {
  const theme = useTheme()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <PrivacyCard />

      <Card>
        <CardContent className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Choose a light or dark theme, or follow your device setting.
            </p>
          </div>
          <ToggleGroup
            aria-label="Appearance"
            variant="outline"
            spacing={0}
            value={[theme]}
            // Single-select base-ui group returns a one-item array; ignore an empty
            // array so the active theme can't be toggled off (one is always chosen).
            onValueChange={(value) => {
              const next = value[0] as Theme | undefined
              if (next) setTheme(next)
            }}
            className="w-full"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} className="flex-1 gap-1.5">
                <Icon className="size-4" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Climb previews</h2>
            <p className="text-sm text-muted-foreground">
              Show a board thumbnail of each problem, per screen.
            </p>
          </div>
          {PREVIEW_OPTIONS.map((option) => (
            <PreviewToggleRow key={option.surface} {...option} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Link
            to="/logbook/import"
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
          >
            <Download className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Import from MoonBoard</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Bring your logbook over from the official MoonBoard app.
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
