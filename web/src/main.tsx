import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import './App.css'
// Side-effect: registers the theme store's cross-tab `storage` sync and the
// System-preference matchMedia listener (live OS light/dark flips), independent of
// whether the Settings screen is mounted. The pre-paint script in index.html has
// already applied the initial theme; this keeps it reactive thereafter.
import './shell/themeStore'
import { AuthProvider } from './auth/AuthProvider'
import { router } from './router'

// AuthProvider sits ABOVE the router: it does async session work (Supabase
// detectSessionInUrl on the OAuth return) that the router's guards may read.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
