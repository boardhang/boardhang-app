// The one definition of a problem's canonical catalog path:
// `/board/{layout}/catalog?angle={angle}&problem={id}` — built from the problem row's own
// fields, angle always explicit. Shared by the client Share button (problemShareUrl.ts)
// and the link-preview functions (api/_lib/problemMeta.ts), so the two can never drift.
// A LEAF module on purpose (no imports): api/ runs as Node ESM and may only import
// leaf modules from src/.

export interface ProblemPathFields {
  layout_id: number
  angle: number
  source_catalog_id: string
}

export function problemCatalogPath(problem: ProblemPathFields): string {
  const params = new URLSearchParams({
    angle: String(problem.angle),
    problem: problem.source_catalog_id,
  })
  return `/board/${problem.layout_id}/catalog?${params.toString()}`
}
