// Device-local appearance preference: Light / Dark / System. Mirrors iOS's
// appearance setting (System/Light/Dark) but stored web-native under the `theme`
// localStorage key. Persisted and exposed reactively so the Settings toggle and the
// document theme update together.
//
// This store OWNS the imperative theme side-effects: it toggles `.dark` on <html>
// and rewrites the `theme-color` meta whenever the resolved theme changes. The same
// resolve logic is duplicated (necessarily) by the pre-paint inline script in
// `index.html`, which runs before this bundle loads to avoid a flash of the wrong
// theme — keep the two in sync.

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
/** The concrete theme actually applied to the document (System resolved). */
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'theme'
// Keep in sync with the <meta name="theme-color"> defaults in index.html.
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#111111', light: '#ffffff' }

function read(): Theme {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    return 'system'
  }
}

function write(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Best-effort — restricted embedders (Safari private mode, Bluefy) can throw.
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** Resolve System → the concrete theme the OS currently prefers. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

/** Apply the resolved theme to the document: `.dark` class + `theme-color` meta. */
function apply(theme: Theme): void {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved])
}

const listeners = new Set<() => void>()
let snapshot = read()

function emit(): void {
  snapshot = read()
  apply(snapshot)
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  // Cross-tab: another tab changed the preference.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === KEY) emit()
  })
  // Live OS theme flips (e.g. sunset) only matter while the preference is System.
  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (snapshot === 'system') emit()
    })
  }
}

export function getTheme(): Theme {
  return snapshot
}

export function setTheme(theme: Theme): void {
  write(theme)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive appearance preference for components (e.g. the Settings toggle). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme)
}
