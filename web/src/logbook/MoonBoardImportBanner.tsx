// A dismissable nudge at the top of the logbook pointing returning MoonBoard-app users to
// the GDPR import flow (/logbook/import). Once dismissed it stays gone (localStorage), and
// the same destination is always reachable from Settings — so dismissing loses nothing.

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { safeGetItem, safeSetItem } from '@/lib/pwa'

const DISMISSED_KEY = 'moonboard.importBannerDismissed'

export function MoonBoardImportBanner() {
  const [dismissed, setDismissed] = useState(() => safeGetItem(DISMISSED_KEY) === '1')
  if (dismissed) return null

  const dismiss = () => {
    safeSetItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  return (
    <Card role="region" aria-label="Import from MoonBoard" className="mb-4 shrink-0 border-primary/30">
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 font-medium">Climbed on the MoonBoard app before?</p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss import banner"
            onClick={dismiss}
            className="-mt-1 -mr-1 shrink-0"
          >
            <X />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Bring your existing logbook across with a quick data request.
          </p>
          <Link
            to="/logbook/import"
            className={buttonVariants({ size: 'sm', className: 'shrink-0' })}
          >
            Import
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
