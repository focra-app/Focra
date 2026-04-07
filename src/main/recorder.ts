import { desktopCapturer } from 'electron'
import { writeFile } from 'fs/promises'

export interface MouseEvent {
  x: number
  y: number
  timestamp: number
  type: 'click' | 'move'
}

export interface ZoomKeyframe {
  id: string
  time: number
  duration: number
  x: number
  y: number
  scale: number
  easing: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear'
  motionBlur: boolean
}

export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export async function getDesktopSources() {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 }
  })

  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIconUrl: s.appIcon ? s.appIcon.toDataURL() : null,
    displayId: s.display_id || null
  }))
}

export function generateAutoZoomKeyframes(
  mouseEvents: MouseEvent[],
  videoDuration: number,
  captureBounds: CaptureBounds
): ZoomKeyframe[] {
  if (captureBounds.width <= 0 || captureBounds.height <= 0) return []

  const clicks = mouseEvents.filter((e) => e.type === 'click')
  const keyframes: ZoomKeyframe[] = []
  const boundsLeft = captureBounds.x
  const boundsTop = captureBounds.y
  const boundsRight = captureBounds.x + captureBounds.width
  const boundsBottom = captureBounds.y + captureBounds.height

  for (let i = 0; i < clicks.length; i++) {
    const click = clicks[i]
    const timeSeconds = click.timestamp / 1000

    if (timeSeconds > videoDuration) continue
    if (click.x < boundsLeft || click.x >= boundsRight || click.y < boundsTop || click.y >= boundsBottom) continue

    // Avoid overlapping keyframes
    const lastKf = keyframes[keyframes.length - 1]
    if (lastKf && timeSeconds < lastKf.time + lastKf.duration + 0.5) continue

    const normalizedX = Math.max(0, Math.min(1, (click.x - boundsLeft) / captureBounds.width))
    const normalizedY = Math.max(0, Math.min(1, (click.y - boundsTop) / captureBounds.height))

    keyframes.push({
      id: `auto-${i}-${click.timestamp}`,
      time: Math.max(0, timeSeconds - 0.3),
      duration: 1.5,
      x: normalizedX,
      y: normalizedY,
      scale: 2.0,
      easing: 'ease-in-out',
      motionBlur: true
    })
  }

  return keyframes
}

export async function saveVideoFile(buffer: Buffer, filePath: string): Promise<void> {
  await writeFile(filePath, buffer)
}
