import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers, getCurrentRecordingSourceId } from './ipc-handlers'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    trafficLightPosition: { x: 16, y: 16 },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    },
    show: false
  })

  win.once('ready-to-show', () => {
    if (process.platform === 'win32') {
      // Workaround for Windows black screen on startup.
      // We wait for the first frame to render, then force a DWM repaint with a resize toggle.
      // We do NOT use setOpacity because it converts the window to a layered window,
      // which breaks screen recorders capturing this app!
      win.show()
      setTimeout(() => {
        const bounds = win.getBounds()
        win.setBounds({ width: bounds.width + 1 })
        win.setBounds(bounds)
      }, 150)
    } else {
      win.show()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
        shell.openExternal(url)
      }
    } catch {
      // Malformed URL — do nothing
    }
    return { action: 'deny' }
  })

  win.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => {
      const sourceId = getCurrentRecordingSourceId()
      if (!request.videoRequested || !sourceId) {
        callback({ video: undefined })
        return
      }
      
      callback({
        video: { id: sourceId, name: 'Recording Source' },
        ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {})
      })
    },
    { useSystemPicker: false }
  )

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
