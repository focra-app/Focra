import { useState } from 'react'
import { Download, X, Check } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import type { EditorProject, ExportSettings, ZoomKeyframe } from '../../types'

interface ExportDialogProps {
  onClose: () => void
}

const ASPECT_RATIOS: ExportSettings['aspectRatio'][] = ['16:9', '4:3', '1:1', '9:16']
const RESOLUTIONS: ExportSettings['resolution'][] = ['720p', '1080p', '1440p', '4k']
const FPS_OPTIONS: ExportSettings['fps'][] = [24, 30, 60]

type ExportFormatOption = {
  value: ExportSettings['format']
  label: string
  extension: string
  mimeTypes: string[]
}

const FORMAT_OPTIONS: ExportFormatOption[] = [
  {
    value: 'webm',
    label: 'WebM (Auto)',
    extension: 'webm',
    mimeTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  },
  {
    value: 'webm-vp9',
    label: 'WebM (VP9)',
    extension: 'webm',
    mimeTypes: ['video/webm;codecs=vp9,opus']
  },
  {
    value: 'webm-vp8',
    label: 'WebM (VP8)',
    extension: 'webm',
    mimeTypes: ['video/webm;codecs=vp8,opus']
  },
  {
    value: 'mp4',
    label: 'MP4 (H.264)',
    extension: 'mp4',
    mimeTypes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
  }
]

const MAX_MOTION_BLUR_PX = 1.5
const MOTION_BLUR_SCALE_FACTOR = 1.2
const MIN_VISIBLE_MOTION_BLUR_PX = 0.5
const MIN_EXPORT_BITRATE = 3_000_000
const MAX_EXPORT_BITRATE = 35_000_000
const EXPORT_BITS_PER_PIXEL_PER_FRAME = 0.08

function AspectRatioIcon({ ratio }: { ratio: string }) {
  const dims: Record<string, { w: number; h: number }> = {
    '16:9': { w: 32, h: 18 },
    '4:3': { w: 28, h: 21 },
    '1:1': { w: 24, h: 24 },
    '9:16': { w: 18, h: 32 }
  }
  const d = dims[ratio] || { w: 32, h: 18 }
  return (
    <div className="flex items-center justify-center" style={{ width: 40, height: 40 }}>
      <div className="border-2 border-current rounded-sm" style={{ width: d.w, height: d.h }} />
    </div>
  )
}

function cubicEase(t: number, easing: ZoomKeyframe['easing']): number {
  switch (easing) {
    case 'ease-in': return t * t * t
    case 'ease-out': return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    default: return t
  }
}

function getZoomTransform(keyframes: ZoomKeyframe[], time: number) {
  const activeKeyframe = keyframes.reduce<ZoomKeyframe | null>((latest, kf) => {
    const inTime = kf.time
    const outTime = kf.time + kf.duration
    if (time < inTime || time > outTime) return latest
    if (latest === null || kf.time > latest.time) return kf
    return latest
  }, null)

  if (!activeKeyframe) {
    return { scale: 1, tx: 0, ty: 0, motionBlur: false }
  }

  const kf = activeKeyframe
  const inTime = kf.time
  const outTime = kf.time + kf.duration
  const halfDur = kf.duration * 0.25

  let scale = 1

  if (time < inTime + halfDur) {
    const progress = (time - inTime) / halfDur
    scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
  } else if (time > outTime - halfDur) {
    const progress = (outTime - time) / halfDur
    scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
  } else {
    scale = kf.scale
  }

  const tx = (0.5 - kf.x) * (scale - 1)
  const ty = (0.5 - kf.y) * (scale - 1)

  return { scale, tx, ty, motionBlur: kf.motionBlur && scale > 1.05 }
}

function getDimensions(settings: ExportSettings) {
  const ratioMap: Record<ExportSettings['aspectRatio'], number> = {
    '16:9': 16 / 9,
    '4:3': 4 / 3,
    '1:1': 1,
    '9:16': 9 / 16
  }
  const baseHeightMap: Record<ExportSettings['resolution'], number> = {
    '720p': 720,
    '1080p': 1080,
    '1440p': 1440,
    '4k': 2160
  }

  const ratio = ratioMap[settings.aspectRatio]
  const baseHeight = baseHeightMap[settings.resolution]
  const width = Math.max(2, Math.round((baseHeight * ratio) / 2) * 2)
  const height = Math.max(2, Math.round(baseHeight / 2) * 2)

  return { width, height }
}

function getFormatOption(format: ExportSettings['format']) {
  return FORMAT_OPTIONS.find((option) => option.value === format) ?? FORMAT_OPTIONS[0]
}

function getSupportedMimeType(option: ExportFormatOption): string | null {
  return option.mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'seeked'): Promise<void> {
  if (eventName === 'loadedmetadata' && video.readyState >= 1) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const onDone = () => {
      video.removeEventListener(eventName, onDone)
      resolve()
    }
    video.addEventListener(eventName, onDone, { once: true })
  })
}

async function seekTo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001) return
  const seekedPromise = waitForVideoEvent(video, 'seeked')
  video.currentTime = time
  await seekedPromise
}

async function loadBackgroundImage(project: EditorProject): Promise<HTMLImageElement | null> {
  const { background } = project
  if (background.type !== 'image' || !background.imageUrl) return null

  const image = new Image()
  image.src = background.imageUrl

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Failed to load background image for export'))
  })

  return image
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: EditorProject,
  video: HTMLVideoElement,
  renderTime: number,
  width: number,
  height: number,
  bgImage: HTMLImageElement | null
) {
  const W = width
  const H = height

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const bg = project.background
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color || '#0f0f0f'
    ctx.fillRect(0, 0, W, H)
  } else if (bg.type === 'gradient' && bg.gradient) {
    const { type, stops, angle = 0 } = bg.gradient
    let grad: CanvasGradient
    if (type === 'linear') {
      const rad = (angle * Math.PI) / 180
      const x1 = W / 2 - (Math.cos(rad) * W) / 2
      const y1 = H / 2 - (Math.sin(rad) * H) / 2
      const x2 = W / 2 + (Math.cos(rad) * W) / 2
      const y2 = H / 2 + (Math.sin(rad) * H) / 2
      grad = ctx.createLinearGradient(x1, y1, x2, y2)
    } else {
      grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) / 2)
    }
    stops.forEach((stop) => grad.addColorStop(stop.position, stop.color))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  } else if (bg.type === 'image' && bgImage && bgImage.naturalWidth > 0) {
    const imgRatio = bgImage.naturalWidth / bgImage.naturalHeight
    const canvasRatio = W / H
    let sx = 0
    let sy = 0
    let sw = bgImage.naturalWidth
    let sh = bgImage.naturalHeight

    if (imgRatio > canvasRatio) {
      sw = bgImage.naturalHeight * canvasRatio
      sx = (bgImage.naturalWidth - sw) / 2
    } else {
      sh = bgImage.naturalWidth / canvasRatio
      sy = (bgImage.naturalHeight - sh) / 2
    }

    ctx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, W, H)
  } else {
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, W, H)
  }

  if (video.readyState < 2) return

  const { scale, tx, ty, motionBlur } = getZoomTransform(project.zoomKeyframes, renderTime)

  const crop = project.cropSettings
  const srcX = crop ? crop.x * video.videoWidth : 0
  const srcY = crop ? crop.y * video.videoHeight : 0
  const srcW = crop ? crop.width * video.videoWidth : video.videoWidth
  const srcH = crop ? crop.height * video.videoHeight : video.videoHeight

  const padding = Math.round(Math.min(W, H) * 0.045)
  const availW = Math.max(1, W - padding * 2)
  const availH = Math.max(1, H - padding * 2)
  const ratio = srcW / srcH
  let dw = availW
  let dh = availW / ratio
  if (dh > availH) {
    dh = availH
    dw = availH * ratio
  }
  const dx = (W - dw) / 2
  const dy = (H - dh) / 2

  ctx.save()
  if (motionBlur) {
    const blurPixels = Math.min(
      MAX_MOTION_BLUR_PX,
      Math.max(0, (scale - 1) * MOTION_BLUR_SCALE_FACTOR)
    )
    if (blurPixels >= MIN_VISIBLE_MOTION_BLUR_PX) {
      ctx.filter = `blur(${blurPixels.toFixed(2)}px)`
    }
  }

  ctx.translate(W / 2 + tx * dw, H / 2 + ty * dh)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(video, srcX, srcY, srcW, srcH, dx, dy, dw, dh)
  ctx.restore()

  const visibleAnnotations = project.annotations.filter(
    (annotation) => renderTime >= annotation.time && renderTime <= annotation.time + annotation.duration
  )

  for (const annotation of visibleAnnotations) {
    const ax = annotation.x * W
    const ay = annotation.y * H
    ctx.save()

    if (annotation.type === 'text') {
      ctx.font = `bold ${annotation.fontSize || 24}px -apple-system, sans-serif`
      ctx.fillStyle = annotation.color
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 4
      ctx.fillText(annotation.text || '', ax, ay)
    } else if (annotation.type === 'arrow' && annotation.endX !== undefined && annotation.endY !== undefined) {
      const ex = annotation.endX * W
      const ey = annotation.endY * H
      const sw = annotation.strokeWidth || 3
      ctx.strokeStyle = annotation.color
      ctx.lineWidth = sw
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ex, ey)
      ctx.stroke()

      const angle = Math.atan2(ey - ay, ex - ax)
      const arrowLen = 16
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4))
      ctx.moveTo(ex, ey)
      ctx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4))
      ctx.stroke()
    }

    ctx.restore()
  }
}

async function renderVideoWithEffects(project: EditorProject, settings: ExportSettings): Promise<Blob> {
  const formatOption = getFormatOption(settings.format)
  const mimeType = getSupportedMimeType(formatOption)
  if (!mimeType) {
    throw new Error(`${formatOption.label} export is not supported by this system`)
  }

  const { width, height } = getDimensions(settings)
  const startTime = Math.max(0, Math.min(project.duration, project.trimPoints.inPoint))
  const endTime = Math.max(startTime + 0.05, Math.min(project.duration, project.trimPoints.outPoint))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to initialize export renderer')

  const video = document.createElement('video')
  video.src = project.videoUrl
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true

  await waitForVideoEvent(video, 'loadedmetadata')
  await seekTo(video, startTime)

  const bgImage = await loadBackgroundImage(project)
  drawFrame(ctx, project, video, startTime, width, height, bgImage)

  const canvasStream = canvas.captureStream(settings.fps)

  if (typeof video.captureStream === 'function') {
    try {
      const audioStream = video.captureStream()
      for (const track of audioStream.getAudioTracks()) {
        canvasStream.addTrack(track)
      }
    } catch {
      // Continue with video-only export if audio stream capture fails.
    }
  }

  const pixelRate = width * height * settings.fps
  const videoBitsPerSecond = Math.min(
    MAX_EXPORT_BITRATE,
    Math.max(MIN_EXPORT_BITRATE, Math.round(pixelRate * EXPORT_BITS_PER_PIXEL_PER_FRAME))
  )

  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond
  })

  const chunks: Blob[] = []
  let raf = 0
  let finished = false

  const finishRecording = () => {
    if (finished) return
    finished = true
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    video.pause()
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  const exportBlobPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    recorder.onerror = () => {
      reject(new Error('Export recording failed'))
    }

    recorder.onstop = () => {
      canvasStream.getTracks().forEach((track) => track.stop())
      resolve(new Blob(chunks, { type: mimeType }))
    }
  })

  const renderLoop = () => {
    const renderTime = Math.min(video.currentTime, endTime)
    drawFrame(ctx, project, video, renderTime, width, height, bgImage)

    if (video.currentTime >= endTime || video.ended) {
      finishRecording()
      return
    }

    raf = requestAnimationFrame(renderLoop)
  }

  recorder.start(1000)
  video.currentTime = startTime
  await video.play()
  raf = requestAnimationFrame(renderLoop)

  return exportBlobPromise
}

export default function ExportDialog({ onClose }: ExportDialogProps) {
  const { project, setExportSettings } = useEditorStore()
  const [exporting, setExporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null
  const settings = project.exportSettings

  const update = (partial: Partial<ExportSettings>) => {
    setExportSettings({ ...settings, ...partial })
  }

  const availableFormatOptions = FORMAT_OPTIONS.filter((option) => getSupportedMimeType(option) !== null)

  const handleExport = async () => {
    setExporting(true)
    setError(null)

    try {
      const selectedOption = getFormatOption(settings.format)
      const filteredOption = getSupportedMimeType(selectedOption) ? selectedOption : availableFormatOptions[0]

      if (!filteredOption) {
        throw new Error('No supported export formats are available on this system')
      }

      if (filteredOption.value !== settings.format) {
        update({ format: filteredOption.value })
      }

      const exportedBlob = await renderVideoWithEffects(project, { ...settings, format: filteredOption.value })

      const result = await window.electronAPI.showSaveDialog({
        defaultName: `focra-export.${filteredOption.extension}`,
        filters: [
          { name: `${filteredOption.label} Video`, extensions: [filteredOption.extension] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.saveToken) {
        setExporting(false)
        return
      }

      const buffer = await exportedBlob.arrayBuffer()
      const saveResult = await window.electronAPI.saveFile(result.saveToken, buffer)
      if (!saveResult.success) {
        throw new Error(saveResult.error ?? 'Failed to save exported file')
      }

      setDone(true)
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-bg-secondary rounded-2xl border border-border w-[520px] shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Download size={18} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary">Export Video</h2>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Aspect Ratio */}
          <div className="space-y-2">
            <span className="label">Aspect Ratio</span>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => update({ aspectRatio: ratio })}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all
                    ${settings.aspectRatio === ratio
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-[#444]'}`}
                >
                  <AspectRatioIcon ratio={ratio} />
                  <span className="text-xs font-medium">{ratio}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-2">
            <span className="label">Resolution</span>
            <div className="grid grid-cols-4 gap-2">
              {RESOLUTIONS.map((resolution) => (
                <button
                  key={resolution}
                  onClick={() => update({ resolution })}
                  className={`py-2 rounded-xl border-2 text-sm font-medium transition-all
                    ${settings.resolution === resolution
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-[#444]'}`}
                >
                  {resolution === '4k' ? '4K' : resolution}
                </button>
              ))}
            </div>
          </div>

          {/* Format + FPS */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="label">Format</span>
              <div className="grid grid-cols-2 gap-2">
                {FORMAT_OPTIONS.map((option) => {
                  const isSupported = getSupportedMimeType(option) !== null
                  return (
                    <button
                      key={option.value}
                      disabled={!isSupported}
                      onClick={() => update({ format: option.value })}
                      className={`py-2 px-2 rounded-lg border-2 text-xs font-medium transition-all
                        ${settings.format === option.value
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-text-secondary hover:border-[#444]'}
                        ${isSupported ? '' : 'opacity-40 cursor-not-allowed'}`}
                      title={isSupported ? option.label : `${option.label} is not supported on this system`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-2">
              <span className="label">Frame Rate</span>
              <div className="flex gap-2">
                {FPS_OPTIONS.map((fps) => (
                  <button
                    key={fps}
                    onClick={() => update({ fps })}
                    className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all
                      ${settings.fps === fps
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:border-[#444]'}`}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-text-muted bg-bg-tertiary rounded-lg p-3">
            Export now renders timeline effects (zoom, crop, annotations, and background) into the final file.
          </p>

          {!availableFormatOptions.length && (
            <p className="text-red-400 text-sm">No supported export formats are available on this device.</p>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1" disabled={exporting}>
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || done || !availableFormatOptions.length}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-semibold transition-all
                ${done
                  ? 'bg-green-700 text-white'
                  : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-60'}`}
            >
              {done ? (
                <><Check size={18} /> Exported!</>
              ) : exporting ? (
                <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Exporting...</>
              ) : (
                <><Download size={18} /> Export</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
