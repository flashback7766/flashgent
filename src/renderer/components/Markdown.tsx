import hljs from 'highlight.js/lib/common'
import { memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { closeOpenFences, splitHighlightedLines } from '../lib/markdown.js'
import { useApp } from '../store/app.js'

interface CodeBlockProps {
  code: string
  language: string
}

/**
 * Highlighting is memoised on the exact code string. During streaming the
 * block re-renders on every token, and re-highlighting each time is the single
 * most expensive thing the chat view does.
 */
const CodeBlock = memo(function CodeBlock({ code, language }: CodeBlockProps) {
  const collapseOver = useApp((s) => s.config?.appearance.collapseCodeOverLines ?? 20)
  const showLineNumbers = useApp((s) => s.config?.appearance.showLineNumbers ?? true)
  const saveSnippet = useApp((s) => s.saveSnippet)
  const toast = useApp((s) => s.toast)

  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code])
  const collapsible = lines.length > collapseOver
  const [expanded, setExpanded] = useState(false)

  const html = useMemo(() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, language])

  const visible = collapsible && !expanded

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    toast('success', 'Copied')
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-faint">
          {language || 'text'}
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void saveSnippet(code, language || 'text')}
            className="rounded px-2 py-0.5 text-[11px] text-muted hover:bg-line hover:text-ink"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded px-2 py-0.5 text-[11px] text-muted hover:bg-line hover:text-ink"
          >
            Copy
          </button>
        </div>
      </div>

      <div className={visible ? 'relative max-h-[22rem] overflow-hidden' : 'overflow-x-auto'}>
        <pre className="m-0 p-3 font-mono text-[12.5px] leading-[1.55]">
          {showLineNumbers ? (
            <code className="hljs grid grid-cols-[auto_1fr] gap-x-3">
              {splitHighlightedLines(html, lines.length).map((lineHtml, i) => (
                // Positional key is correct here: a line's identity is its number.
                <span key={i} className="contents">
                  <span className="select-none text-right text-faint">{i + 1}</span>
                  <span dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }} />
                </span>
              ))}
            </code>
          ) : (
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </pre>
        {visible && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-raised to-transparent" />
        )}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-line px-3 py-1.5 text-[11px] text-muted hover:bg-line hover:text-ink"
        >
          {expanded ? 'Collapse' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  )
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface MarkdownProps {
  content: string
  /** Streaming text gets its fences auto-closed as it arrives. */
  streaming?: boolean
}

export const Markdown = memo(function Markdown({ content, streaming }: MarkdownProps) {
  const source = streaming ? closeOpenFences(content) : content

  return (
    <div className="text-[14px] leading-[1.7] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          h1: ({ children }) => <h1 className="mt-5 mb-2 text-lg font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-5 mb-2 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-sm font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand underline underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-line pl-3 text-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-line" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-line bg-raised px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
          code: ({ className, children }) => {
            const text = String(children ?? '')
            const match = /language-(\w+)/.exec(className ?? '')

            // Inline code has no language class and no newlines.
            if (!match && !text.includes('\n')) {
              return (
                <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12.5px] text-brand">
                  {children}
                </code>
              )
            }
            return <CodeBlock code={text.replace(/\n$/, '')} language={match?.[1] ?? ''} />
          },
          pre: ({ children }: { children?: ReactNode }) => <>{children}</>
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
})
