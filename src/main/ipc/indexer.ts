import fg from 'fast-glob'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CH } from '../../shared/ipc.js'
import type { ProjectIndexSummary } from '../../shared/types.js'
import { ignoreMatcher, resolveSafePath } from '../safety.js'
import { handleN } from './result.js'

const toPosix = (p: string): string => p.split('\\').join('/')

const EXPORT_REGEX =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+([A-Za-z0-9_$]+)/g

export function registerIndexerHandlers(): void {
  handleN<ProjectIndexSummary>(CH.indexerScan, async (cwd: string) => {
    const root = resolveSafePath('.', cwd, 'read')
    const matcher = ignoreMatcher(root)

    // Scan source files
    const allFiles = await fg('**/*.{ts,tsx,js,jsx,py,go,rs,json,md,html,css}', {
      cwd: root,
      dot: false,
      onlyFiles: true,
      deep: 8,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.flashgent/**', '**/out/**']
    })

    const filtered = allFiles.filter((rel) => !matcher.ignores(toPosix(rel)))
    const exports: Array<{ file: string; symbols: string[] }> = []

    for (const rel of filtered.slice(0, 100)) {
      const full = join(root, rel)
      try {
        const raw = await readFile(full, 'utf8')
        const matches = [...raw.matchAll(EXPORT_REGEX)].map((m) => m[1] || '')
        const uniqueSymbols = [...new Set(matches)].filter(Boolean)
        if (uniqueSymbols.length > 0) {
          exports.push({ file: toPosix(rel), symbols: uniqueSymbols.slice(0, 15) })
        }
      } catch {
        // Skip unreadable files
      }
    }

    const structureText = filtered.slice(0, 80).join('\n')

    const summary: ProjectIndexSummary = {
      filesCount: filtered.length,
      keyFiles: filtered.slice(0, 20).map(toPosix),
      exports: exports.slice(0, 30),
      structureText
    }

    // Cache locally in .flashgent/index.json
    try {
      const cacheDir = join(root, '.flashgent')
      await mkdir(cacheDir, { recursive: true })
      await writeFile(join(cacheDir, 'index.json'), JSON.stringify(summary, null, 2), 'utf8')
    } catch {
      // Non-fatal if .flashgent cache write fails
    }

    return summary
  })

  handleN<ProjectIndexSummary | null>(CH.indexerGet, async (cwd: string) => {
    const root = resolveSafePath('.', cwd, 'read')
    const cacheFile = join(root, '.flashgent', 'index.json')
    if (!existsSync(cacheFile)) return null
    try {
      const raw = await readFile(cacheFile, 'utf8')
      return JSON.parse(raw) as ProjectIndexSummary
    } catch {
      return null
    }
  })
}
