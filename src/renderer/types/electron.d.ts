import type { ZoomKeyframe } from '../types'

interface ElectronMediaConstraints {
  audio: false | { mandatory: { chromeMediaSource: string; chromeMediaSourceId: string } }
  video: { mandatory: { chromeMediaSource: string; chromeMediaSourceId: string; maxWidth: number; maxHeight: number; maxFrameRate: number } }
}

interface MouseClickData {
  x: number
  y: number
  timestamp: number
}

interface ElectronAPI {
  getSources: () => Promise<import('../types').DesktopSource[]>
  /** Returns a one-time save token (not a raw file path) for use with saveFile. */
  showSaveDialog: (
    options: string | {
      defaultName: string
      filters?: Array<{ name: string; extensions: string[] }>
    }
  ) => Promise<{ canceled: boolean; saveToken: string | null; error?: string }>
  /** Accepts a one-time token from showSaveDialog; returns success/error info. */
  saveFile: (token: string, buffer: ArrayBuffer) => Promise<{ success: boolean; error?: string }>
  generateZoomKeyframes: (
    mouseEvents: Array<{ x: number; y: number; timestamp: number; type: 'click' | 'move' }>,
    videoDuration: number,
    captureBounds: import('../types').CaptureBounds
  ) => Promise<ZoomKeyframe[]>
  getSourceBounds: (sourceId: string, displayId?: string | null) => Promise<import('../types').CaptureBounds>
  /** Starts global cursor-position polling in the main process for auto-zoom tracking. */
  startMouseTracking: (recordingStartTime: number, captureBounds: import('../types').CaptureBounds) => Promise<void>
  stopMouseTracking: () => Promise<void>
  /** Subscribe to dwell events emitted by the main process during recording. Returns an unsubscribe fn. */
  onMouseClick: (callback: (data: MouseClickData) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
  interface MediaDevices {
    getUserMedia(constraints: ElectronMediaConstraints): Promise<MediaStream>
  }
}

export {}
