import type { MDXComponents } from 'mdx/types'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => <h1 className="text-3xl font-semibold" {...props} />,
    h2: (props) => <h2 className="mt-10 text-2xl font-semibold" {...props} />,
    h3: (props) => <h3 className="mt-6 text-lg font-semibold" {...props} />,
    p: (props) => <p className="mt-4 leading-relaxed" {...props} />,
    ul: (props) => <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed" {...props} />,
    ol: (props) => <ol className="mt-4 list-decimal space-y-2 pl-6 leading-relaxed" {...props} />,
    hr: (props) => <hr className="my-10 border-[var(--border)]" {...props} />,
    blockquote: (props) => (
      <blockquote
        className="mt-4 border-l-2 border-[var(--border)] pl-4 text-[var(--muted)]"
        {...props}
      />
    ),
    ...components,
  }
}
