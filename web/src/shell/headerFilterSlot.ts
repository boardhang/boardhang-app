// A shell-owned mount point inside the frosted sticky header, below the SessionPill slot.
// AppLayout renders an empty `.app-header-slot` element and publishes it here; a route
// (today only the catalog) portals its filter-pill bar into it via createPortal. This
// lets the bar live in the sticky header — inheriting the blur/scroll-shadow — while its
// component keeps rendering inside CatalogScreen where the filter data and the
// seed-writing `setFilters` live. The portal teleports only the DOM output, not the data.
// Empty (every non-catalog route) ⇒ `.app-header-slot:empty` collapses it to zero height,
// so it costs nothing when unused. Mirrors bottomSlot.ts.

import { createContext, useContext } from 'react'

/** The slot element, or null before AppLayout has mounted it. */
export const HeaderFilterSlotContext = createContext<HTMLElement | null>(null)

export function useHeaderFilterSlot(): HTMLElement | null {
  return useContext(HeaderFilterSlotContext)
}
