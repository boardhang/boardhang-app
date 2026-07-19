import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Keep a single React instance so newly-added deps (e.g. @dnd-kit/*) can't be pre-bundled
    // against a second copy — a duplicate React makes hooks throw "Invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // History routing: serve the app shell for any client-side route so a
        // deep link (e.g. /board/7/catalog?...) or the OAuth return survives a
        // hard load. The hash fragment (#access_token=…) is client-side only, so
        // detectSessionInUrl still sees it. Hashed build assets are excluded so
        // they resolve to the real file, not index.html.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/assets\//],
        // The ~433 kB QR-decoder WASM is fetched on demand when the scanner opens,
        // never precached — it would bloat every install for a feature most users
        // rarely touch. A CacheFirst runtime route keeps repeat scans decodable
        // (and offline-warm) without paying the download on every open.
        globIgnores: ['**/*.wasm'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'qr-decoder-wasm',
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
      manifest: {
        name: 'Boardhang',
        short_name: 'Boardhang',
        description:
          'Build a problem on the grid and light it on your DIY MoonBoard LEDs over Web Bluetooth.',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
