import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/**
 * Directories the agent must never write into, and never read out of. These are
 * OS surfaces where an edit is either useless or actively dangerous.
 */
function protectedRoots(): string[] {
  const roots: string[] = [tmpdir()]
  if (process.platform === 'win32') {
    const sysDrive = process.env.SystemDrive ?? 'C:'
    roots.push(
      process.env.SystemRoot ?? join(sysDrive, 'Windows'),
      process.env.ProgramFiles ?? join(sysDrive, 'Program Files'),
      process.env['ProgramFiles(x86)'] ?? join(sysDrive, 'Program Files (x86)'),
      process.env.ProgramData ?? join(sysDrive, 'ProgramData'),
      join(homedir(), 'AppData', 'Local', 'Temp')
    )
  } else {
    roots.push('/bin', '/sbin', '/usr/bin', '/usr/sbin', '/boot', '/sys', '/proc', '/dev', '/etc')
  }
  return roots.filter(Boolean).map((r) => resolve(r))
}

/** Extensions the agent may not create, overwrite, or hand to the shell. */
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.dll',
  '.sys',
  '.pif'
])

export class SafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SafetyError'
  }
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child)
  const p = resolve(parent)
  if (process.platform === 'win32') {
    return c.toLowerCase() === p.toLowerCase() || c.toLowerCase().startsWith(p.toLowerCase() + sep)
  }
  return c === p || c.startsWith(p + sep)
}

/**
 * Resolve `path` against `cwd` and reject it if it lands somewhere the agent
 * is not allowed to touch. Returns the absolute, normalised path.
 */
export function resolveSafePath(path: string, cwd: string, mode: 'read' | 'write'): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path)

  for (const root of protectedRoots()) {
    if (isInside(absolute, root)) {
      throw new SafetyError(
        `Refusing to ${mode} inside a protected system location: ${root}. ` +
          `If this is intentional, do it manually outside flashgent.`
      )
    }
  }

  if (mode === 'write' && BLOCKED_EXTENSIONS.has(extname(absolute).toLowerCase())) {
    throw new SafetyError(
      `Refusing to write an executable file (${extname(absolute)}). ` +
        `Blocked extensions: ${[...BLOCKED_EXTENSIONS].join(', ')}.`
    )
  }

  return absolute
}

/** Reject a shell command that would invoke a blocked executable directly. */
export function assertShellCommandAllowed(command: string): void {
  const lowered = command.toLowerCase()
  for (const ext of BLOCKED_EXTENSIONS) {
    // Match the extension only when it terminates a token, so `foo.exercise`
    // and `--out=x.dll-ish` do not trip the check.
    const pattern = new RegExp(`\\${ext}(?=$|[\\s"';|&)])`)
    if (pattern.test(lowered)) {
      throw new SafetyError(`Refusing to run a command that invokes a ${ext} file.`)
    }
  }
}

// --- Ignore rules ----------------------------------------------------------

const ignoreCache = new Map<string, { matcher: Ignore; loadedAt: number }>()
const IGNORE_TTL_MS = 10_000

/** Directories never worth walking, regardless of what .gitignore says. */
const ALWAYS_IGNORED = [
  '.git/',
  'node_modules/',
  'dist/',
  'out/',
  'build/',
  '.next/',
  '.cache/',
  'target/',
  '__pycache__/',
  '.venv/',
  'venv/'
]

/**
 * Build a matcher from the project's .gitignore plus .flashgentignore.
 * Cached briefly so a wide grep does not re-read the files for every match.
 */
export function ignoreMatcher(cwd: string): Ignore {
  const cached = ignoreCache.get(cwd)
  if (cached && Date.now() - cached.loadedAt < IGNORE_TTL_MS) return cached.matcher

  const matcher = ignore().add(ALWAYS_IGNORED)
  for (const name of ['.gitignore', '.flashgentignore']) {
    const file = join(cwd, name)
    if (!existsSync(file)) continue
    try {
      matcher.add(readFileSync(file, 'utf8'))
    } catch {
      // An unreadable ignore file just means fewer exclusions.
    }
  }

  ignoreCache.set(cwd, { matcher, loadedAt: Date.now() })
  return matcher
}

/** `relativePath` must be posix-style and relative to `cwd`. */
export function isIgnored(matcher: Ignore, relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith('..')) return false
  return matcher.ignores(relativePath)
}
