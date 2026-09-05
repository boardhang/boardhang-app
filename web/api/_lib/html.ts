// Escaping for the meta document. Problem names and setter names are user-submitted
// upstream (MoonBoard), so every row string that lands in HTML text or an attribute
// goes through here.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape a string for use as HTML text or inside a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}
