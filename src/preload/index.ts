import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIconUrl: string | null
}

export interface MouseEventData {
  x: number
  y: number
  timestamp: number
  type: 'click' | 'move'
}

const api = {
  getSources: (): Promise<DesktopSource[]> => ipcRenderer.invoke('get-sources'),

  showSaveDialog: (defaultName: string): Promise<Electron.SaveDialogReturnValue> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),

  saveFile: (buffer: ArrayBuffer, filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-file', buffer, filePath),

  generateZoomKeyframes: (
    mouseEvents: MouseEventData[],
    videoDuration: number,
    screenWidth: number,
    screenHeight: number
  ) => ipcRenderer.invoke('generate-zoom-keyframes', mouseEvents, videoDuration, screenWidth, screenHeight),

  getScreenSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('get-screen-size')
}

contextBridge.exposeInMainWorld('electronAPI', api)
