import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Test config lives in vitest.config.ts (kept separate so `tsc -b` doesn't
// type-check Vitest's bundled-vite types against this project's rolldown Vite).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'MoonBoard LED',
        short_name: 'MoonBoard',
        description:
          'Build a problem on the grid and light it on your DIY MoonBoard LEDs over Web Bluetooth.',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
