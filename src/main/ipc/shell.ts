import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { CH } from '../../shared/ipc.js'
import type { BackgroundTask, ShellRequest, ShellResult } from '../../shared/types.js'
import { logger } from '../logger.js'
import { assertShellCommandAllowed, resolveSafePath } from '../safety.js'
import { handle, handleN } from './result.js'

const DEFAULT_TIMEOUT_MS = 30_000
/** Cap what we hand back to the model so one noisy command cannot eat the window. */
const MAX_OUTPUT_CHARS = 30_000

interface RunningTask {
  id: string
  command: string
  cwd: string
  child: ChildProcessWithoutNullStreams
  stdout: string
  stderr: string
  exitCode: number | null
  running: boolean
  startedAt: number
}

const tasks = new Map<string, RunningTask>()

function shellCommandFor(
  command: string,
  preferred: ShellRequest['shell']
): { file: string; args: string[] } {
  const useBash = preferred === 'bash' || (preferred === undefined && process.platform !== 'win32')

  if (useBash) {
    const file = process.platform === 'win32' ? 'bash.exe' : 'bash'
    return { file, args: ['-lc', command] }
  }
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
  }
}

function clip(text: string, limit = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  const head = text.slice(0, limit / 2)
  const tail = text.slice(-limit / 2)
  return { text: `${head}\n\n… [output truncated] …\n\n${tail}`, truncated: true }
}

export function registerShellHandlers(): void {
  handle<ShellRequest, ShellResult>(CH.shellRun, async (req) => {
    assertShellCommandAllowed(req.command)
    // Validates the directory is not inside a protected root.
    const cwd = resolveSafePath('.', req.cwd, 'read')

    const { file, args } = shellCommandFor(req.command, req.shell)
    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      env: process.env
    }) as ChildProcessWithoutNullStreams

    const id = randomUUID()
    const task: RunningTask = {
      id,
      command: req.command,
      cwd,
      child,
      stdout: '',
      stderr: '',
      exitCode: null,
      running: true,
      startedAt: Date.now()
    }
    tasks.set(id, task)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      task.stdout += chunk
      if (task.stdout.length > MAX_OUTPUT_CHARS * 2) {
        task.stdout = clip(task.stdout, MAX_OUTPUT_CHARS).text
      }
    })
    child.stderr.on('data', (chunk: string) => {
      task.stderr += chunk
      if (task.stderr.length > MAX_OUTPUT_CHARS * 2) {
        task.stderr = clip(task.stderr, MAX_OUTPUT_CHARS).text
      }
    })

    const settled = new Promise<number | null>((resolveExit) => {
      child.on('close', (code) => {
        task.running = false
        task.exitCode = code
        resolveExit(code)
      })
      child.on('error', (err) => {
        task.running = false
        task.stderr += `\n${err.message}`
        task.exitCode = -1
        resolveExit(-1)
      })
    })

    // Background: hand the caller a task id and let it keep running.
    if (req.background) {
      logger.info(`background task ${id} started: ${req.command}`)
      // Clean up finished background tasks after a retention window (5 mins)
      void settled.then(() => {
        setTimeout(
          () => {
            tasks.delete(id)
          },
          5 * 60 * 1000
        )
      })
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        truncated: false,
        taskId: id
      }
    }

    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const exitCode = await settled
    clearTimeout(timer)
    tasks.delete(id)

    const limit = req.maxOutputChars ?? MAX_OUTPUT_CHARS
    const out = clip(task.stdout, limit)
    const err = clip(task.stderr, limit)
    return {
      stdout: out.text,
      stderr: err.text,
      exitCode,
      timedOut,
      truncated: out.truncated || err.truncated
    }
  })

  handle<void, BackgroundTask[]>(CH.shellTasks, () =>
    [...tasks.values()].map((t) => ({
      id: t.id,
      command: t.command,
      cwd: t.cwd,
      running: t.running,
      exitCode: t.exitCode,
      startedAt: t.startedAt
    }))
  )

  handleN<ShellResult>(CH.shellOutput, (taskId: string) => {
    const task = tasks.get(taskId)
    if (!task) throw new Error(`No background task with id ${taskId}`)
    const out = clip(task.stdout)
    const err = clip(task.stderr)
    return {
      stdout: out.text,
      stderr: err.text,
      exitCode: task.exitCode,
      timedOut: false,
      truncated: out.truncated || err.truncated,
      taskId
    }
  })

  handleN<boolean>(CH.shellKill, (taskId: string) => {
    const task = tasks.get(taskId)
    if (!task) return false
    task.child.kill('SIGKILL')
    task.running = false
    return true
  })
}

/** Kill anything still running so quitting the app does not orphan processes. */
export function killAllTasks(): void {
  for (const task of tasks.values()) {
    if (task.running) {
      try {
        task.child.kill('SIGKILL')
      } catch {
        // The process may already be gone.
      }
    }
  }
  tasks.clear()
}
