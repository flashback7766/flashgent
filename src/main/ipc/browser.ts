import { BrowserWindow } from 'electron'
import { CH } from '../../shared/ipc.js'
import type { BrowsePageRequest, BrowsePageResult } from '../../shared/types.js'
import { handle } from './result.js'

export function registerBrowserHandlers(): void {
  handle<BrowsePageRequest, BrowsePageResult>(CH.browserBrowse, async (req) => {
    const timeoutMs = req.timeoutMs ?? 15_000
    const errors: string[] = []

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: true
      }
    })

    try {
      win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) {
          // Warning or Error
          errors.push(message)
        }
      })

      // Load URL with timeout guard
      await Promise.race([
        win.loadURL(req.url),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Navigation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
      ])

      if (req.waitForSelector) {
        await win.webContents.executeJavaScript(`
          new Promise((resolve) => {
            if (document.querySelector('${req.waitForSelector.replace(/'/g, "\\'")}')) return resolve(true);
            const observer = new MutationObserver(() => {
              if (document.querySelector('${req.waitForSelector.replace(/'/g, "\\'")}')) {
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(false); }, 5000);
          })
        `)
      }

      const title = win.getTitle()

      // Extract rendered text content from document body
      const content = await win.webContents.executeJavaScript(`
        (() => {
          const scripts = document.querySelectorAll('script, style, noscript, svg');
          scripts.forEach(s => s.remove());
          return document.body ? (document.body.innerText || document.body.textContent || '') : '';
        })()
      `)

      let screenshotBase64: string | undefined
      if (req.captureScreenshot) {
        const image = await win.capturePage()
        screenshotBase64 = image.toJPEG(80).toString('base64')
      }

      return {
        url: win.webContents.getURL(),
        title,
        content: String(content).trim().slice(0, 50_000),
        consoleErrors: errors.slice(0, 20),
        screenshotBase64,
        status: 200
      }
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  })
}
