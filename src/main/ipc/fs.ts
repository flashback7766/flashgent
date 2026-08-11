import { dialog, ipcMain } from 'electron'
import fg from 'fast-glob'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { CH } from '../../shared/ipc.js'
import type {
  FileEditRequest,
  FileEditResult,
  FileReadRequest,
  FileReadResult,
  FileWriteRequest,
  GlobRequest,
  GrepMatch,
  GrepRequest
} from '../../shared/types.js'
import { ignoreMatcher, isIgnored, resolveSafePath } from '../safety.js'
import { handle, handleN } from './result.js'

/** Files above this size are refused outright rather than silently clipped. */
const MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_READ_LINES = 2000
const MAX_GLOB_RESULTS = 500
const MAX_GREP_RESULTS = 200

const toPosix = (p: string): string => p.split('\\').join('/')

export function registerFsHandlers(): void {
  handle<FileReadRequest, FileReadResult>(CH.fsRead, async (req) => {
    const path = resolveSafePath(req.path, req.cwd, 'read')

    if (!existsSync(path)) {
      // Probing for an optional file (FLASHGENT.md, CLAUDE.md) is not an error.
      if (req.optional) return { path, content: '', totalLines: 0, truncated: false }
      throw new Error(`File not found: ${req.path}`)
    }
    const stat = statSync(path)
    if (stat.isDirectory()) throw new Error(`${req.path} is a directory, not a file.`)
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `File is ${(stat.size / 1024 / 1024).toFixed(1)} MB, over the 1 MB limit. ` +
          `Ask the user how to proceed, or read a specific line range with offset/limit.`
      )
    }

    const raw = await readFile(path, 'utf8')
    const lines = raw.split(/\r?\n/)
    const offset = Math.max(0, req.offset ?? 0)
    const limit = req.limit ?? DEFAULT_READ_LINES
    const slice = lines.slice(offset, offset + limit)

    return {
      path,
      content: slice.join('\n'),
      totalLines: lines.length,
      truncated: offset + slice.length < lines.length
    }
  })

  handle<FileWriteRequest, { path: string; created: boolean }>(CH.fsWrite, async (req) => {
    const path = resolveSafePath(req.path, req.cwd, 'write')
    const created = !existsSync(path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, req.content, 'utf8')
    return { path, created }
  })

  handle<FileEditRequest, FileEditResult>(CH.fsEdit, async (req) => {
    const path = resolveSafePath(req.path, req.cwd, 'write')
    if (!existsSync(path)) throw new Error(`File not found: ${req.path}`)

    const before = await readFile(path, 'utf8')
    const occurrences = countOccurrences(before, req.oldString)

    if (occurrences === 0) {
      throw new Error(
        `The text to replace was not found in ${req.path}. ` +
          `Read the file again — it may have changed, or the indentation may differ.`
      )
    }
    if (occurrences > 1 && !req.replaceAll) {
      throw new Error(
        `Found ${occurrences} occurrences in ${req.path}. ` +
          `Include more surrounding context to make the match unique, or set replaceAll.`
      )
    }

    const after = req.replaceAll
      ? before.split(req.oldString).join(req.newString)
      : before.replace(req.oldString, req.newString)

    await writeFile(path, after, 'utf8')
    return {
      path,
      replacements: req.replaceAll ? occurrences : 1,
      diff: unifiedDiff(relative(req.cwd, path) || path, before, after)
    }
  })

  handle<GlobRequest, string[]>(CH.fsGlob, async (req) => {
    const root = resolveSafePath('.', req.cwd, 'read')
    const matcher = ignoreMatcher(root)

    const entries = await fg(toPosix(req.pattern), {
      cwd: root,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true,
      objectMode: true
    })

    return entries
      .filter((e) => !isIgnored(matcher, e.path))
      .sort((a, b) => statMtime(resolve(root, b.path)) - statMtime(resolve(root, a.path)))
      .slice(0, req.limit ?? MAX_GLOB_RESULTS)
      .map((e) => e.path)
  })

  handle<GrepRequest, GrepMatch[]>(CH.fsGrep, async (req) => {
    const root = resolveSafePath('.', req.cwd, 'read')
    const matcher = ignoreMatcher(root)
    const regex = new RegExp(req.pattern, req.caseInsensitive ? 'i' : '')
    const limit = req.limit ?? MAX_GREP_RESULTS

    const files = await fg(req.glob ? toPosix(req.glob) : '**/*', {
      cwd: root,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true
    })

    const matches: GrepMatch[] = []
    for (const rel of files) {
      if (matches.length >= limit) break
      if (isIgnored(matcher, rel)) continue

      const absolute = resolve(root, rel)
      try {
        if (statSync(absolute).size > MAX_FILE_BYTES) continue
        const content = await readFile(absolute, 'utf8')
        // Skip anything that looks binary rather than emitting mojibake.
        if (content.includes('\u0000')) continue

        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i]
          if (text === undefined || !regex.test(text)) continue
          matches.push({ path: rel, line: i + 1, text: text.slice(0, 400) })
          if (matches.length >= limit) break
        }
      } catch {
        // Unreadable file — skip it and keep searching.
      }
    }
    return matches
  })

  handle<{ path: string; cwd: string }, string[]>(CH.fsListDir, async (req) => {
    const dir = resolveSafePath(req.path || '.', req.cwd, 'read')
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort((a, b) => {
        const aDir = a.endsWith('/')
        const bDir = b.endsWith('/')
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.localeCompare(b)
      })
  })

  ipcMain.handle(CH.fsPickDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a working directory'
    })
    const picked = result.canceled ? null : (result.filePaths[0] ?? null)
    return { ok: true, value: picked }
  })

  handleN<string[]>(CH.fsPickFiles, async (cwd: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      defaultPath: cwd,
      title: 'Attach files to the conversation'
    })
    return result.canceled ? [] : result.filePaths
  })

  handleN<FileReadResult[]>(
    CH.fsResolveDropped,
    async (paths: string[], cwd: string) => {
      const out: FileReadResult[] = []
      for (const p of paths.slice(0, 20)) {
        try {
          const path = resolveSafePath(p, cwd, 'read')
          const stat = statSync(path)
          if (stat.isDirectory() || stat.size > MAX_FILE_BYTES) continue
          const raw = await readFile(path, 'utf8')
          if (raw.includes('\u0000')) continue
          const lines = raw.split(/\r?\n/)
          out.push({
            path,
            content: lines.slice(0, DEFAULT_READ_LINES).join('\n'),
            totalLines: lines.length,
            truncated: lines.length > DEFAULT_READ_LINES
          })
        } catch {
          // A file we cannot read is simply not attached.
        }
      }
      return out
    }
  )
}

function statMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

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

/**
 * Compact unified diff. Good enough to render an edit in the UI without
 * pulling in a full diffing library.
 */
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
