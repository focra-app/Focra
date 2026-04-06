import type { ZoomKeyframe } from '../types'

interface ElectronAPI {
  getSources: () => Promise<import('../types').DesktopSource[]>
  showSaveDialog: (defaultName: string) => Promise<{ canceled: boolean; filePath?: string }>
  saveFile: (buffer: ArrayBuffer, filePath: string) => Promise<{ success: boolean }>
  generateZoomKeyframes: (
    mouseEvents: Array<{ x: number; y: number; timestamp: number; type: 'click' | 'move' }>,
    videoDuration: number,
    screenWidth: number,
    screenHeight: number
  ) => Promise<ZoomKeyframe[]>
  getScreenSize: () => Promise<{ width: number; height: number }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
