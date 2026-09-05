# api/_assets

Static files the Vercel functions read at runtime. The underscore prefix keeps this
directory out of the function list; files are resolved relative to the module that
uses them (`new URL('../_assets/…', import.meta.url)`), which the builder traces.

- `Geist-Regular.ttf` — the card font for `api/og-image`. Geist by Vercel, licensed
  under the SIL Open Font License 1.1 (<https://github.com/vercel/geist-font/blob/main/LICENSE.TXT>).
  Satori only accepts TTF/OTF/WOFF, so the app's woff2 `@fontsource-variable/geist`
  can't be reused here.
