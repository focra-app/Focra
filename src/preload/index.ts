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

  showSaveDialog: (defaultName: string): Promise<{ canceled: boolean; saveToken: string | null }> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),

  saveFile: (token: string, buffer: ArrayBuffer): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('save-file', token, buffer),

  generateZoomKeyframes: (
    mouseEvents: MouseEventData[],
    videoDuration: number,
    screenWidth: number,
    screenHeight: number
  ) => ipcRenderer.invoke('generate-zoom-keyframes', mouseEvents, videoDuration, screenWidth, screenHeight),

  getScreenSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('get-screen-size'),

  startMouseTracking: (recordingStartTime: number): Promise<void> =>
    ipcRenderer.invoke('start-mouse-tracking', recordingStartTime),

  stopMouseTracking: (): Promise<void> =>
    ipcRenderer.invoke('stop-mouse-tracking'),

  onMouseClick: (
    callback: (data: { x: number; y: number; timestamp: number }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { x: number; y: number; timestamp: number }
    ) => callback(data)
    ipcRenderer.on('mouse-click', handler)
    return () => ipcRenderer.removeListener('mouse-click', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
