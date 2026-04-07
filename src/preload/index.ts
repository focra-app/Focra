import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIconUrl: string | null
  displayId?: string | null
}

export interface MouseEventData {
  x: number
  y: number
  timestamp: number
  type: 'click' | 'move'
}

export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
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
    captureBounds: CaptureBounds
  ) => ipcRenderer.invoke('generate-zoom-keyframes', mouseEvents, videoDuration, captureBounds),

  getSourceBounds: (sourceId: string, displayId?: string | null): Promise<CaptureBounds> =>
    ipcRenderer.invoke('get-source-bounds', sourceId, displayId),

  startMouseTracking: (recordingStartTime: number, captureBounds: CaptureBounds): Promise<void> =>
    ipcRenderer.invoke('start-mouse-tracking', recordingStartTime, captureBounds),

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
