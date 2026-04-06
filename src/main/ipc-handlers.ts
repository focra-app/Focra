import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDesktopSources, generateAutoZoomKeyframes, saveVideoFile } from './recorder'
import type { MouseEvent } from './recorder'

export function registerIpcHandlers(): void {
  ipcMain.handle('get-sources', async () => {
    return getDesktopSources()
  })

  ipcMain.handle('show-save-dialog', async (_event, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: 'Video', extensions: ['webm', 'mp4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result
  })

  ipcMain.handle('save-file', async (_event, buffer: ArrayBuffer, filePath: string) => {
    const buf = Buffer.from(buffer)
    await saveVideoFile(buf, filePath)
    return { success: true }
  })

  ipcMain.handle(
    'generate-zoom-keyframes',
    async (
      _event,
      mouseEvents: MouseEvent[],
      videoDuration: number,
      screenWidth: number,
      screenHeight: number
    ) => {
      return generateAutoZoomKeyframes(mouseEvents, videoDuration, screenWidth, screenHeight)
    }
  )

  ipcMain.handle('get-screen-size', async () => {
    const { screen } = await import('electron')
    const display = screen.getPrimaryDisplay()
    return {
      width: display.size.width,
      height: display.size.height
    }
  })
}
