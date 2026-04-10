export interface ZoomKeyframe {
  id: string
  time: number          // seconds from start
  duration: number      // seconds
  x: number             // 0-1 normalized center x
  y: number             // 0-1 normalized center y
  scale: number         // zoom level (1 = no zoom, 2 = 2x)
  easing: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear'
  motionBlur: boolean
}

export interface Annotation {
  id: string
  type: 'text' | 'arrow'
  time: number
  duration: number
  x: number
  y: number
  text?: string
  fontSize?: number
  color: string
  endX?: number
  endY?: number
  strokeWidth?: number
}

export interface TrimPoints {
  inPoint: number
  outPoint: number
}

export interface Background {
  type: 'solid' | 'gradient' | 'image'
  color?: string
  gradient?: {
    type: 'linear' | 'radial'
    stops: Array<{ color: string; position: number }>
    angle?: number
  }
  imageUrl?: string
}

export interface ExportSettings {
  aspectRatio: '16:9' | '4:3' | '1:1' | '9:16'
  resolution: '720p' | '1080p' | '1440p' | '4k'
  format: 'webm' | 'webm-vp9' | 'webm-vp8' | 'mp4'
  fps: 24 | 30 | 60
}

export interface CropSettings {
  x: number
  y: number
  width: number
  height: number
}

export interface EditorProject {
  videoUrl: string
  duration: number
  zoomKeyframes: ZoomKeyframe[]
  annotations: Annotation[]
  trimPoints: TrimPoints
  background: Background
  cropSettings: CropSettings | null
  exportSettings: ExportSettings
}

export interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIconUrl: string | null
  displayId: string | null
}

export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface RecordingResult {
  videoUrl: string
  videoBlob: Blob
  duration: number
  zoomKeyframes: ZoomKeyframe[]
}

export type Tool = 'select' | 'text' | 'arrow' | 'crop'

export type AppPage = 'record' | 'editor'
