import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Vitest config, separate from vite.config.ts so `tsc -b` (which type-checks
// vite.config.ts) never sees Vitest's bundled-vite plugin types, which clash
// with this project's rolldown-based Vite 8. Vitest loads this file at runtime
// only. We merge the app's Vite config so the React plugin (JSX transform)
// applies to component tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
)
