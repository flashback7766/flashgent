/**
 * A fenced block that is still streaming has no closing ```. Close it so the
 * markdown parser renders a code block instead of dumping raw backticks into
 * the page mid-generation.
 */
export function closeOpenFences(markdown: string): string {
  const fences = markdown.match(/^```/gm)?.length ?? 0
  return fences % 2 === 1 ? `${markdown}\n\`\`\`` : markdown
}

/**
 * highlight.js emits one HTML string whose spans may straddle newlines.
 * Re-open any span a line break interrupted so each rendered line is
 * self-contained and can sit in its own grid row next to a line number.
 */
export function splitHighlightedLines(html: string, expectedLines: number): string[] {
  const lines = html.split('\n')
  const out: string[] = []
  const open: string[] = []

  for (const current of lines) {
    const prefix = open.join('')

    for (const tag of current.match(/<span[^>]*>|<\/span>/g) ?? []) {
      if (tag === '</span>') open.pop()
      else open.push(tag)
    }

    out.push(prefix + current + '</span>'.repeat(open.length))
  }

  // If the highlighter reflowed the content, fall back to the raw split so we
  // never render a different number of lines than the source has.
  return out.length === expectedLines ? out : lines
}
