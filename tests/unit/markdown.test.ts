import { describe, expect, it } from 'vitest'
import { mergeConfig } from '../../src/shared/config.js'
import { closeOpenFences, splitHighlightedLines } from '../../src/renderer/lib/markdown.js'

describe('closeOpenFences', () => {
  it('closes a fence that is still streaming', () => {
    expect(closeOpenFences('```ts\nconst a = 1')).toBe('```ts\nconst a = 1\n```')
  })

  it('leaves balanced fences alone', () => {
    const source = '```ts\nconst a = 1\n```'
    expect(closeOpenFences(source)).toBe(source)
  })

  it('leaves plain prose alone', () => {
    expect(closeOpenFences('just text')).toBe('just text')
  })

  it('handles two complete blocks plus a third still opening', () => {
    const source = '```a\n1\n```\ntext\n```b\n2\n```\nmore\n```c\n3'
    expect(closeOpenFences(source).endsWith('\n```')).toBe(true)
  })
})

describe('splitHighlightedLines', () => {
  it('reopens a span that a newline interrupted', () => {
    const html = '<span class="hljs-string">line one\nline two</span>'

    const lines = splitHighlightedLines(html, 2)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('<span class="hljs-string">line one</span>')
    expect(lines[1]).toBe('<span class="hljs-string">line two</span>')
  })

  it('leaves single-line markup untouched', () => {
    const html = '<span class="hljs-keyword">const</span> a = 1'
    expect(splitHighlightedLines(html, 1)).toEqual([html])
  })

  it('falls back to the raw split when the line count disagrees', () => {
    const html = 'a\nb\nc'
    expect(splitHighlightedLines(html, 99)).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeConfig', () => {
  it('returns defaults for junk input', () => {
    // maxIterations is the hard ceiling above every effort level's own budget.
    expect(mergeConfig(null).agent.maxIterations).toBe(100)
    expect(mergeConfig(null).effort).toBe('high')
    expect(mergeConfig(null).permissionMode).toBe('manual')
    expect(mergeConfig('nonsense').endpoints).toHaveLength(1)
  })

  it('keeps user values while filling in keys added by a newer build', () => {
    const merged = mergeConfig({ agent: { maxIterations: 5 }, telemetryOptIn: true })

    expect(merged.agent.maxIterations).toBe(5)
    // Untouched keys inside the same nested object survive.
    expect(merged.agent.toolTimeoutMs).toBe(30_000)
    expect(merged.telemetryOptIn).toBe(true)
    expect(merged.appearance.theme).toBe('system')
  })

  it('does not let an empty endpoint list wipe the default', () => {
    expect(mergeConfig({ endpoints: [] }).endpoints).toHaveLength(1)
  })
})
