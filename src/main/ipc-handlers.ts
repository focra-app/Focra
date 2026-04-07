import { ipcMain, dialog, BrowserWindow, screen } from 'electron'
import { randomUUID } from 'crypto'
import { getDesktopSources, generateAutoZoomKeyframes, saveVideoFile } from './recorder'
import type { CaptureBounds, MouseEvent } from './recorder'

// One-time tokens for secure file saving: token → { filePath, expiresAt }
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes
const pendingSavePaths = new Map<string, { filePath: string; expiresAt: number }>()

// Periodically remove tokens that were never redeemed (e.g. user cancelled export)
setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of pendingSavePaths) {
    if (now > entry.expiresAt) {
      pendingSavePaths.delete(token)
    }
  }
}, TOKEN_TTL_MS).unref()

// Global mouse tracking state
let mouseTrackingInterval: ReturnType<typeof setInterval> | null = null
let lastStablePos = { x: 0, y: 0 }
let stableFrameCount = 0
const STABLE_THRESHOLD_PX = 8   // pixels of movement to reset dwell counter
const DWELL_FRAMES_REQUIRED = 5 // × 100 ms polling = 500 ms dwell → emit event

function getCaptureBounds(sourceId: string, displayId?: string | null) {
  // Build a virtual desktop rectangle spanning all connected displays.
  const virtualBounds = screen.getAllDisplays().reduce(
    (acc, display) => {
      const left = display.bounds.x
      const top = display.bounds.y
      const right = display.bounds.x + display.bounds.width
      const bottom = display.bounds.y + display.bounds.height
      return {
        x: Math.min(acc.x, left),
        y: Math.min(acc.y, top),
        right: Math.max(acc.right, right),
        bottom: Math.max(acc.bottom, bottom)
      }
    },
    { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity }
  )

  const fallbackBounds =
    Number.isFinite(virtualBounds.x) &&
    Number.isFinite(virtualBounds.y) &&
    Number.isFinite(virtualBounds.right) &&
    Number.isFinite(virtualBounds.bottom)
      ? {
          x: virtualBounds.x,
          y: virtualBounds.y,
          width: virtualBounds.right - virtualBounds.x,
          height: virtualBounds.bottom - virtualBounds.y
        }
      : screen.getPrimaryDisplay().bounds

  if (sourceId.startsWith('screen')) {
    const numericDisplayId = displayId != null ? Number(displayId) : NaN
    const sourceDisplay = Number.isFinite(numericDisplayId)
      ? screen.getAllDisplays().find((display) => display.id === numericDisplayId)
      : undefined
    return sourceDisplay?.bounds ?? fallbackBounds
  }

  return fallbackBounds
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-sources', async () => {
    return getDesktopSources()
  })

  ipcMain.handle('show-save-dialog', async (_event, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.SaveDialogOptions = {
      defaultPath: defaultName,
      filters: [
        { name: 'WebM Video', extensions: ['webm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)

    if (!result.canceled && result.filePath) {
      const token = randomUUID()
      pendingSavePaths.set(token, { filePath: result.filePath, expiresAt: Date.now() + TOKEN_TTL_MS })
      return { canceled: false, saveToken: token }
    }
    return { canceled: true, saveToken: null }
  })

  // Accepts a one-time token (from show-save-dialog) instead of a raw file path to
  // prevent an arbitrary file-write primitive if the renderer is ever compromised.
  ipcMain.handle('save-file', async (_event, token: string, buffer: ArrayBuffer) => {
    const entry = pendingSavePaths.get(token)
    if (!entry || Date.now() > entry.expiresAt) {
      pendingSavePaths.delete(token)
      return { success: false, error: 'Invalid or expired save token' }
    }
    pendingSavePaths.delete(token) // one-time use
    const { filePath } = entry
    try {
      await saveVideoFile(Buffer.from(buffer), filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'generate-zoom-keyframes',
    async (_event, mouseEvents: MouseEvent[], videoDuration: number, captureBounds: CaptureBounds) => {
      return generateAutoZoomKeyframes(mouseEvents, videoDuration, captureBounds)
    }
  )

  ipcMain.handle('get-source-bounds', async (_event, sourceId: string, displayId?: string | null) => {
    return getCaptureBounds(sourceId, displayId)
  })

  // Poll the global cursor position so clicks in other app windows are captured.
  // A "dwell event" (cursor stable for ≥500 ms) is treated as a zoom anchor point.
  ipcMain.handle('start-mouse-tracking', (_event, recordingStartTime: number, captureBounds: CaptureBounds) => {
    if (mouseTrackingInterval) clearInterval(mouseTrackingInterval)

    const { sender } = _event
    lastStablePos = screen.getCursorScreenPoint()
    stableFrameCount = 0

    mouseTrackingInterval = setInterval(() => {
      if (sender.isDestroyed()) {
        clearInterval(mouseTrackingInterval!)
        mouseTrackingInterval = null
        return
      }
      const pos = screen.getCursorScreenPoint()
      const inBounds =
        pos.x >= captureBounds.x &&
        pos.y >= captureBounds.y &&
        pos.x <= captureBounds.x + captureBounds.width &&
        pos.y <= captureBounds.y + captureBounds.height

      if (!inBounds) {
        stableFrameCount = 0
        lastStablePos = pos
        return
      }

      const dist = Math.hypot(pos.x - lastStablePos.x, pos.y - lastStablePos.y)
      if (dist < STABLE_THRESHOLD_PX) {
        stableFrameCount++
        if (stableFrameCount === DWELL_FRAMES_REQUIRED) {
          // Cursor has dwelt long enough — use as a zoom keyframe anchor
          sender.send('mouse-click', {
            x: pos.x,
            y: pos.y,
            timestamp: Date.now() - recordingStartTime
          })
        }
      } else {
        stableFrameCount = 0
        lastStablePos = pos
      }
    }, 100)
  })

  ipcMain.handle('stop-mouse-tracking', () => {
    if (mouseTrackingInterval) {
      clearInterval(mouseTrackingInterval)
      mouseTrackingInterval = null
    }
  })
}
