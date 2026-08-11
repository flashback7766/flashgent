export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(1)}k`
}

/** Shorten a path for display: keep the last two segments. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  sh: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  toml: 'ini'
}

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CODE_EXTENSIONS[ext] ?? 'text'
}
