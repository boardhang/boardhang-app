type JsonLdProps = {
  data: Record<string, unknown>
}

// Renders a JSON-LD structured-data block. The '<' escape prevents a
// crafted string value from closing the script tag early.
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll('<', '\\u003c') }}
    />
  )
}
