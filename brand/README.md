# Boardhang brand assets

The Boardhang mark is **"Resin Jug b"**: a lowercase b drawn as a poured-resin climbing
hold in brand blue, with a green LED lit inside its bolt-hole counter — the app's
"tap a hold, it lights up" gesture in one shape.

## Colors

| Role | Hex |
| --- | --- |
| Hold body (brand blue) | `#3B82F6` |
| LED (lit green) | `#34D97B` |
| Tile / icon background | `#0E1116` |

## Files

All SVGs share a 240×240 viewBox and are self-contained.

| File | What | Feeds |
| --- | --- | --- |
| `resin-jug-b-tile.svg` | Mark on a dark rounded-square tile | `web/public/favicon.svg` |
| `resin-jug-b-open.svg` | Tileless mark, bolt hole transparent | `web/public/logo.svg`; in-app use on any surface |
| `resin-jug-b-fullbleed.svg` | Square full-bleed source; jug at 85% for the maskable safe zone | `web/public/pwa-192.png`, `pwa-512.png`, `apple-touch-icon.png`, `github-avatar.png` |
| `github-avatar.png` | 1024×1024 render of the full-bleed source | GitHub org avatar |

## Regenerating rasters

No SVG rasterizer is vendored; on macOS `qlmanage` works:

```bash
qlmanage -t -s <size> -o <outdir> brand/resin-jug-b-fullbleed.svg
```

The web icons live in `web/public/` and are referenced from `web/index.html` and the PWA
manifest in `web/vite.config.ts` (manifest `theme_color`/`background_color` match the
tile background `#0E1116`).
