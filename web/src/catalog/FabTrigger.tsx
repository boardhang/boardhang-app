// The round floating action button shared by the catalog FAB column
// (RecentsSheet, FilterSheet). Mirrors the iOS FABs: a frosted, translucent
// circle (.regularMaterial) with a primary-tinted icon and a soft shadow — not a
// solid fill, so the two stacked FABs stay quiet over the list. Callers supply the
// icon — and any overlay like the filter count badge — as children. `relative` is
// set here so a caller's absolutely-positioned badge anchors to it.
//
// Built entirely from semantic theme tokens so it adapts to a light/dark toggle:
// `bg-card` is the elevated-surface token (= background in light, but lighter than
// the list in dark, so the frosted disc stays separated), `text-primary` is the
// app's blue accent in both modes, and `border-border` flips with the theme.

import type { ComponentProps } from 'react'
import { DrawerTrigger } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

/** The FAB's look, shared with FABs that aren't drawer triggers — the "New problem" FAB
 *  opens its editor through the URL (`?new=1`), so it's a plain button, not a trigger. */
export const FAB_CLASS =
  'pointer-events-auto relative flex size-14 items-center justify-center rounded-full border border-border bg-card/70 text-primary shadow-lg backdrop-blur-md transition hover:bg-card/90'

export function FabTrigger({ className, children, ...props }: ComponentProps<typeof DrawerTrigger>) {
  return (
    <DrawerTrigger className={cn(FAB_CLASS, className)} {...props}>
      {children}
    </DrawerTrigger>
  )
}
