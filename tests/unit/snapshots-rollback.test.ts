import { describe, expect, it } from 'vitest'

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function unifiedDiff(label: string, before: string, after: string): string {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }

  const context = 3
  const from = Math.max(0, start - context)
  const toA = Math.min(a.length - 1, endA + context)
  const toB = Math.min(b.length - 1, endB + context)

  const lines: string[] = [
    `--- ${label}`,
    `+++ ${label}`,
    `@@ -${from + 1},${toA - from + 1} +${from + 1},${toB - from + 1} @@`
  ]
  for (let i = from; i < start; i++) lines.push(` ${a[i] ?? ''}`)
  for (let i = start; i <= endA; i++) lines.push(`-${a[i] ?? ''}`)
  for (let i = start; i <= endB; i++) lines.push(`+${b[i] ?? ''}`)
  for (let i = endA + 1; i <= toA; i++) lines.push(` ${a[i] ?? ''}`)

  return lines.join('\n')
}

describe('File snapshots and diffing utilities', () => {
  it('detects single and multiple occurrences accurately', () => {
    const text = 'foo bar baz foo qux'
    expect(countOccurrences(text, 'foo')).toBe(2)
    expect(countOccurrences(text, 'bar')).toBe(1)
    expect(countOccurrences(text, 'missing')).toBe(0)
  })

  it('generates unified diff with accurate line headers', () => {
    const before = 'line 1\nline 2\nline 3'
    const after = 'line 1\nline 2 modified\nline 3'
    const diff = unifiedDiff('test.txt', before, after)

    expect(diff).toContain('--- test.txt')
    expect(diff).toContain('+++ test.txt')
    expect(diff).toContain('-line 2')
    expect(diff).toContain('+line 2 modified')
  })

  it('handles complete file rewrites in unified diff', () => {
    const before = 'old content'
    const after = 'new content'
    const diff = unifiedDiff('doc.md', before, after)

    expect(diff).toContain('-old content')
    expect(diff).toContain('+new content')
  })
})
