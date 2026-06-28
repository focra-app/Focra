import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { useState } from 'react'
import { Download, X, Check } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import type { EditorProject, ExportSettings, ZoomKeyframe } from '../../types'
import { getZoomTransformAtTime, getZoomTransformFromKeyframe } from './zoomTransform'

interface ExportDialogProps {
  onClose: () => void
}

interface ExportProgressUpdate {
  progress: number
  detail?: string
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

type ZoomTransform = ReturnType<typeof getZoomTransformAtTime>

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
    mimeTypes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm']
  }
]

const MAX_MOTION_BLUR_PX = 1.5
const MOTION_BLUR_SCALE_FACTOR = 1.2
const MIN_VISIBLE_MOTION_BLUR_PX = 0.5
const MIN_EXPORT_BITRATE = 8_000_000
const MAX_EXPORT_BITRATE = 140_000_000
const EXPORT_BITS_PER_PIXEL_PER_FRAME = 0.12
const RENDER_PADDING_PX = 40
const RECORDER_TIMESLICE_MS = 1000
const MIN_EXPORT_DURATION_SECONDS = 0.05
const MEDIA_EVENT_TIMEOUT_MS = 15000
// ~0.5ms tolerance for floating-point time comparisons near trim boundaries.
const END_FRAME_EPSILON_SECONDS = 0.0005
const MAX_UPSCALE_FACTOR = 1.15

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

function getZoomTransform(keyframes: ZoomKeyframe[], time: number): ZoomTransform {
  return getZoomTransformAtTime(keyframes, time)
}

function createSequentialZoomTransformGetter(keyframes: ZoomKeyframe[]) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  let keyframeIndex = 0
  let activeKeyframes: ZoomKeyframe[] = []

  return (time: number): ZoomTransform => {
    if (activeKeyframes.length > 0) {
      activeKeyframes = activeKeyframes.filter((kf) => time <= kf.time + kf.duration)
    }
    while (keyframeIndex < sorted.length && sorted[keyframeIndex].time <= time) {
      activeKeyframes.push(sorted[keyframeIndex])
      keyframeIndex += 1
    }
    const activeKeyframe = activeKeyframes.length > 0 ? activeKeyframes[activeKeyframes.length - 1] : null
    return activeKeyframe ? getZoomTransformFromKeyframe(activeKeyframe, time) : { scale: 1, tx: 0, ty: 0, motionBlur: false }
  }
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

function clampOutputToSourceDimensions(
  requested: { width: number; height: number },
  sourceWidth: number,
  sourceHeight: number
) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { ...requested, wasClamped: false }
  }

  const requestedPixels = requested.width * requested.height
  const sourcePixels = sourceWidth * sourceHeight
  const maxAllowedPixels = sourcePixels * MAX_UPSCALE_FACTOR
  if (requestedPixels <= maxAllowedPixels) {
    return { ...requested, wasClamped: false }
  }

  const scale = Math.sqrt(maxAllowedPixels / requestedPixels)
  const width = Math.max(2, Math.round((requested.width * scale) / 2) * 2)
  const height = Math.max(2, Math.round((requested.height * scale) / 2) * 2)
  return { width, height, wasClamped: true }
}

function getFormatOption(format: ExportSettings['format']) {
  return FORMAT_OPTIONS.find((option) => option.value === format) ?? FORMAT_OPTIONS[0]
}

function getVideoOnlyMimeCandidates(mimeType: string) {
  const [container, params] = mimeType.split(';')
  if (!params || !params.includes('codecs=')) {
    return [mimeType]
  }

  const match = params.match(/codecs=(?:"([^"]+)"|([^;]+))/i)
  const codecsValue = (match?.[1] ?? match?.[2] ?? '').trim()
  if (!codecsValue) {
    return [container]
  }

  const codecList = codecsValue.split(',').map((codec) => codec.trim()).filter(Boolean)
  const videoCodecPrefixes = ['vp8', 'vp9', 'av01', 'avc1', 'hev1', 'hvc1', 'theora', 'mp4v']
  const videoCodecs = codecList.filter((codec) =>
    videoCodecPrefixes.some((prefix) => codec.toLowerCase().startsWith(prefix))
  )

  if (videoCodecs.length === 0) {
    return [container]
  }

  return [`${container};codecs=${videoCodecs.join(',')}`, container]
}

function getSupportedMimeTypeForStream(option: ExportFormatOption, hasAudioTrack: boolean) {
  const candidates = hasAudioTrack
    ? option.mimeTypes
    : option.mimeTypes.flatMap((mimeType) => getVideoOnlyMimeCandidates(mimeType))
  const uniqueCandidates = Array.from(new Set(candidates))
  return uniqueCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

function isFormatSupportedForExport(option: ExportFormatOption) {
  const supportsWithAudio = getSupportedMimeTypeForStream(option, true) !== null
  const supportsVideoOnly = getSupportedMimeTypeForStream(option, false) !== null
  return (
    supportsWithAudio
    || supportsVideoOnly
  )
}

function chooseMimeTypeForCanvasStream(option: ExportFormatOption, canvasStream: MediaStream) {
  const audioTracks = canvasStream.getAudioTracks()
  if (audioTracks.length > 0) {
    const mimeTypeWithAudio = getSupportedMimeTypeForStream(option, true)
    if (mimeTypeWithAudio) {
      return mimeTypeWithAudio
    }
  }

  const videoOnlyMimeType = getSupportedMimeTypeForStream(option, false)
  if (!videoOnlyMimeType) {
    return null
  }

  for (const track of audioTracks) {
    canvasStream.removeTrack(track)
    track.stop()
  }

  return videoOnlyMimeType
}

function computeVisibleAnnotationsForTime(
  sortedAnnotations: EditorProject['annotations'],
  currentVisibleAnnotations: EditorProject['annotations'],
  nextAnnotationIndex: number,
  renderTime: number
) {
  let updatedNextAnnotationIndex = nextAnnotationIndex
  const updatedVisibleAnnotations = [...currentVisibleAnnotations]
  while (
    updatedNextAnnotationIndex < sortedAnnotations.length &&
    sortedAnnotations[updatedNextAnnotationIndex].time <= renderTime
  ) {
    updatedVisibleAnnotations.push(sortedAnnotations[updatedNextAnnotationIndex])
    updatedNextAnnotationIndex += 1
  }

  const filteredVisibleAnnotations = updatedVisibleAnnotations.filter(
    (annotation) => renderTime <= annotation.time + annotation.duration
  )

  return {
    nextAnnotationIndex: updatedNextAnnotationIndex,
    visibleAnnotations: filteredVisibleAnnotations
  }
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'canplay' | 'seeked'
): Promise<void> {
  if (eventName === 'loadedmetadata' && video.readyState >= 1) {
    return Promise.resolve()
  }
  if ((eventName === 'loadeddata' || eventName === 'canplay') && video.readyState >= 2) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined

    const clearListeners = () => {
      video.removeEventListener(eventName, onDone)
      video.removeEventListener('error', onError)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }

    const onDone = () => {
      clearListeners()
      resolve()
    }

    const onError = () => {
      clearListeners()
      reject(new Error(`Video failed while waiting for '${eventName}'`))
    }

    timeoutId = window.setTimeout(() => {
      clearListeners()
      reject(new Error(`Timed out waiting for video event '${eventName}'`))
    }, MEDIA_EVENT_TIMEOUT_MS)

    video.addEventListener(eventName, onDone, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

async function ensureVideoReadyForFrame(video: HTMLVideoElement) {
  if (video.readyState >= 2) return
  await Promise.race([waitForVideoEvent(video, 'loadeddata'), waitForVideoEvent(video, 'canplay')])
}

async function seekTo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001) {
    await ensureVideoReadyForFrame(video)
    return
  }
  const seekedPromise = waitForVideoEvent(video, 'seeked')
  video.currentTime = time
  await seekedPromise
  await ensureVideoReadyForFrame(video)
}

// ---------------------------------------------------------------------------
// Seek-based offline renderer helpers
//
// The old approach played the video in real-time and raced a rAF loop against
// it. Any system load caused frames to be drawn at the wrong currentTime,
// producing repeated/frozen/skipped frames in the output.
//
// These helpers implement seek-based offline rendering: the video is NEVER
// played. For each frame we seek to its exact timestamp, wait for the decoder
// to confirm the frame is ready, draw the canvas, and push it to MediaRecorder.
// ---------------------------------------------------------------------------

/** Wait for the video decoder to settle on the frame we just seeked to.
 *  Uses requestVideoFrameCallback when available (Chromium 86+, Electron 14+)
 *  for frame-accurate confirmation, falls back to seeked + one rAF tick. */
function waitForDecodedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Timed out waiting for decoded video frame'))
    }, MEDIA_EVENT_TIMEOUT_MS)

    const done = () => {
      window.clearTimeout(timeoutId)
      resolve()
    }

    // requestVideoFrameCallback fires only after the compositor has a new
    // decoded frame ready at currentTime — far more reliable than 'seeked',
    // which fires before decoding completes on many codecs.
    if (typeof (video as any).requestVideoFrameCallback === 'function') {
      ;(video as any).requestVideoFrameCallback(done)
    } else {
      // Fallback: 'seeked' + one rAF tick to let the frame paint to the element.
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        requestAnimationFrame(done)
      }
      video.addEventListener('seeked', onSeeked, { once: true })
    }
  })
}

/** Seek to `time` and wait for the decoded frame to be available. */
async function seekToFrame(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.0001) {
    // Already on this frame — still wait for rVFC so we know it’s decoded.
    await waitForDecodedFrame(video)
    return
  }
  const frameReady = waitForDecodedFrame(video)
  video.currentTime = time
  await frameReady
}

async function loadBackgroundImage(project: EditorProject): Promise<HTMLImageElement | null> {
  const { background } = project
  if (background.type !== 'image' || !background.imageUrl) return null

  const image = new Image()
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    // Set src after listeners are attached to avoid missing a cached load event.
    image.src = background.imageUrl
  })

  return loaded ? image : null
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: EditorProject,
  video: HTMLVideoElement,
  renderTime: number,
  width: number,
  height: number,
  bgImage: HTMLImageElement | null,
  precomputed?: {
    zoomTransform?: ZoomTransform
    visibleAnnotations?: EditorProject['annotations']
  }
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

  const { scale, tx, ty, motionBlur } = precomputed?.zoomTransform ?? getZoomTransform(project.zoomKeyframes, renderTime)

  const crop = project.cropSettings
  const srcX = crop ? crop.x * video.videoWidth : 0
  const srcY = crop ? crop.y * video.videoHeight : 0
  const srcW = crop ? crop.width * video.videoWidth : video.videoWidth
  const srcH = crop ? crop.height * video.videoHeight : video.videoHeight

  const padding = RENDER_PADDING_PX
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

  const visibleAnnotations = precomputed?.visibleAnnotations
    ?? project.annotations.filter(
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

async function renderVideoWithEffects(
  project: EditorProject,
  settings: ExportSettings,
  onProgress?: (update: ExportProgressUpdate) => void
): Promise<ArrayBuffer> {
  const formatOption = getFormatOption(settings.format)

  // Two video elements:
  //   videoEl  — provides decoded frames for canvas drawing (muted, always paused)
  //   audioEl  — plays in real-time to supply a live audio track to the stream
  const videoEl = document.createElement('video')
  const audioEl = document.createElement('video')

  const cleanupEls = () => {
    for (const el of [videoEl, audioEl]) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }

  try {
    // ------------------------------------------------------------------
    // 1. Load metadata
    // ------------------------------------------------------------------
    videoEl.src = project.videoUrl
    videoEl.preload = 'auto'
    videoEl.muted = true          // never plays audio — pure decode source
    videoEl.playsInline = true
    await waitForVideoEvent(videoEl, 'loadedmetadata')

    const loadedVideoDuration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0
    const fallbackProjectDuration = Number.isFinite(project.duration) && project.duration > 0 ? project.duration : 0
    const mediaDuration = loadedVideoDuration || fallbackProjectDuration
    if (mediaDuration <= 0) throw new Error('Unable to determine media duration for export')

    const startTime = Math.max(0, Math.min(mediaDuration, project.trimPoints.inPoint))
    const requestedEndTime = Math.min(mediaDuration, project.trimPoints.outPoint)
    const remainingDuration = Math.max(0, mediaDuration - startTime)
    const clampedMinDuration = Math.min(MIN_EXPORT_DURATION_SECONDS, remainingDuration)
    const endTime = Math.min(mediaDuration, Math.max(startTime + clampedMinDuration, requestedEndTime))
    const totalDuration = Math.max(END_FRAME_EPSILON_SECONDS, endTime - startTime)

    const requestedDimensions = getDimensions(settings)
    const { width, height, wasClamped } = clampOutputToSourceDimensions(
      requestedDimensions,
      videoEl.videoWidth,
      videoEl.videoHeight
    )
    if (wasClamped) {
      onProgress?.({
        progress: 0,
        detail: `Requested resolution exceeds source quality. Export capped to ${width}×${height}.`
      })
    }

    // ------------------------------------------------------------------
    // 2. Canvas + captureStream
    // ------------------------------------------------------------------
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to initialize export renderer')

    const bgImage = await loadBackgroundImage(project)

    // Prefer captureStream(0) + requestFrame() so we control when frames are
    // pushed. Fall back to captureStream(fps) if requestFrame is unavailable.
    let canvasStream = canvas.captureStream(0)
    const stopCanvasStreamTracks = () => canvasStream.getTracks().forEach((t) => t.stop())

    let videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
    if (!videoTrack) { stopCanvasStreamTracks(); throw new Error('Unable to initialize export video track') }

    let requestFrame: (() => void) | null =
      typeof videoTrack.requestFrame === 'function' ? () => videoTrack!.requestFrame() : null

    if (!requestFrame) {
      stopCanvasStreamTracks()
      canvasStream = canvas.captureStream(settings.fps)
      videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
      if (!videoTrack) throw new Error('Unable to initialize export video track (fallback)')
      requestFrame = typeof videoTrack.requestFrame === 'function' ? () => videoTrack!.requestFrame() : null
    }

    // ------------------------------------------------------------------
    // 3. Audio track — a separate real-time playback element
    //    Plays silently alongside the seek loop so MediaRecorder captures
    //    a live audio track. The user doesn’t hear it (volume = 0).
    // ------------------------------------------------------------------
    let hasAudio = false
    if (typeof audioEl.captureStream === 'function') {
      try {
        audioEl.src = project.videoUrl
        audioEl.preload = 'auto'
        audioEl.muted = false
        audioEl.volume = 0            // inaudible; stream still carries audio data
        audioEl.playsInline = true
        await waitForVideoEvent(audioEl, 'loadedmetadata')

        const audioStream = audioEl.captureStream()
        const audioTracks = audioStream.getAudioTracks()
        if (audioTracks.length > 0) {
          canvasStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks
          ])
          hasAudio = true
        }
      } catch {
        // No audio — continue with video-only export
      }
    }

    // ------------------------------------------------------------------
    // 4. MediaRecorder
    // ------------------------------------------------------------------
    const selectedMimeType = chooseMimeTypeForCanvasStream(formatOption, canvasStream)
    if (!selectedMimeType) throw new Error(`${formatOption.label} export is not supported`)
    const mimeType = selectedMimeType

    const pixelRate = width * height * settings.fps
    const videoBitsPerSecond = Math.min(
      MAX_EXPORT_BITRATE,
      Math.max(MIN_EXPORT_BITRATE, Math.round(pixelRate * EXPORT_BITS_PER_PIXEL_PER_FRAME))
    )

    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond })
    const recordedChunks: Blob[] = []

    const exportBufferPromise = new Promise<ArrayBuffer>((resolve, reject) => {
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data) }
      recorder.onerror = () => reject(new Error('Export recording failed'))
      recorder.onstop = async () => {
        stopCanvasStreamTracks()
        try {
          resolve(await new Blob(recordedChunks, { type: mimeType }).arrayBuffer())
        } catch (err) {
          reject(new Error(`Export recording failed: ${String(err)}`))
        }
      }
    })

    // ------------------------------------------------------------------
    // 5. Seek-based frame loop
    //    The video is NEVER played. We seek to each frame’s exact timestamp,
    //    wait for decoder confirmation, draw, push, advance. Frame-accurate.
    // ------------------------------------------------------------------
    let capturedRenderError: unknown = null
    let recorderStarted = false

    try {
      const frameDuration = 1 / settings.fps
      const totalFrames = Math.ceil(totalDuration / frameDuration)

      const getSequentialZoomTransform = createSequentialZoomTransformGetter(project.zoomKeyframes)
      const sortedAnnotations = [...project.annotations].sort((a, b) => a.time - b.time)
      let nextAnnotationIndex = 0
      let visibleAnnotations: EditorProject['annotations'] = []

      // Seek to startTime and draw frame 0 before starting the recorder,
      // so the first push is ready immediately when recording begins.
      await seekToFrame(videoEl, startTime)
      drawFrame(ctx, project, videoEl, startTime, width, height, bgImage, {
        zoomTransform: getSequentialZoomTransform(startTime),
        visibleAnnotations: []
      })

      recorder.start(RECORDER_TIMESLICE_MS)
      recorderStarted = true
      onProgress?.({ progress: 0 })

      // Start audio in sync with the recorder so the stream has audio from frame 1.
      if (hasAudio) {
        try {
          audioEl.currentTime = startTime
          await audioEl.play()
        } catch {
          // Audio play failed — continue video-only
        }
      }

      // Push frame 0 (already drawn above).
      requestFrame?.()

      // Iterate remaining frames: seek → decode confirm → draw → push.
      for (let frameIndex = 1; frameIndex < totalFrames; frameIndex++) {
        const frameTime = Math.min(
          startTime + frameIndex * frameDuration,
          endTime - END_FRAME_EPSILON_SECONDS
        )

        await seekToFrame(videoEl, frameTime)

        const annotationUpdate = computeVisibleAnnotationsForTime(
          sortedAnnotations,
          visibleAnnotations,
          nextAnnotationIndex,
          frameTime
        )
        nextAnnotationIndex = annotationUpdate.nextAnnotationIndex
        visibleAnnotations = annotationUpdate.visibleAnnotations

        drawFrame(ctx, project, videoEl, frameTime, width, height, bgImage, {
          zoomTransform: getSequentialZoomTransform(frameTime),
          visibleAnnotations
        })
        requestFrame?.()

        onProgress?.({ progress: Math.min(0.99, frameIndex / totalFrames) })
      }

      // Let the recorder flush its final internal buffer before stopping.
      await new Promise<void>((r) => setTimeout(r, 200))
      if (recorder.state !== 'inactive') recorder.stop()
      onProgress?.({ progress: 1 })
    } catch (err) {
      capturedRenderError = err
    } finally {
      audioEl.pause()
      cleanupEls()
      if (recorderStarted && recorder.state !== 'inactive') recorder.stop()
      stopCanvasStreamTracks()
    }

    if (capturedRenderError) {
      try { await exportBufferPromise } catch { /* ignore */ }
      throw capturedRenderError
    }

    return exportBufferPromise
  } catch (err) {
    cleanupEls()
    throw err
  }
}

export default function ExportDialog({ onClose }: ExportDialogProps) {
  const { project, setExportSettings } = useEditorStore()
  const [exporting, setExporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportDetail, setExportDetail] = useState<string | null>(null)

  if (!project) return null
  const settings = project.exportSettings

  const update = (partial: Partial<ExportSettings>) => {
    setExportSettings({ ...settings, ...partial })
  }

  const availableFormatOptions = FORMAT_OPTIONS.filter((option) => isFormatSupportedForExport(option))

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    setExportProgress(0)
    setExportDetail(null)

    try {
      const selectedOption = getFormatOption(settings.format)
      const filteredOption = isFormatSupportedForExport(selectedOption) ? selectedOption : availableFormatOptions[0]

      if (!filteredOption) {
        throw new Error('No supported export formats are available on this system')
      }

      if (filteredOption.value !== settings.format) {
        update({ format: filteredOption.value })
      }

      // Determine the final extension up-front so the save dialog shows the right
      // file type. For MP4 we optimistically use 'mp4'; if remux later fails we
      // fall back to WebM but by then we already hold the token for the mp4 path
      // — the token's TTL won't be threatened by a long render/transcode.
      const mimeType = filteredOption.mimeTypes[0] || 'video/webm'
      const willRemux = filteredOption.value === 'mp4' && mimeType.includes('webm')
      const expectedExtension = willRemux ? 'mp4' : filteredOption.extension

      // Show the save dialog BEFORE rendering so the token is locked in before
      // any long-running work starts. This prevents token expiry on slow hardware.
      setExportDetail('Choose a save location...')
      const dialogResult = await window.electronAPI.showSaveDialog({
        defaultName: `focra-export.${expectedExtension}`,
        filters: [
          { name: `${expectedExtension.toUpperCase()} Video`, extensions: [expectedExtension] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (dialogResult.error) {
        throw new Error(dialogResult.error)
      }
      if (dialogResult.canceled || !dialogResult.saveToken) {
        setExportDetail('Export canceled.')
        return
      }

      const saveToken = dialogResult.saveToken

      setExportDetail(null)
      const exportedBuffer = await renderVideoWithEffects(
        project,
        { ...settings, format: filteredOption.value },
        ({ progress, detail }) => {
          setExportProgress(Math.max(0, Math.min(1, progress)))
          if (detail) setExportDetail(detail)
        }
      )

      let finalBuffer = exportedBuffer

      if (willRemux) {
        setExportDetail('Remuxing WebM to MP4... This may take a moment.')
        try {
          const ffmpeg = new FFmpeg()
          await ffmpeg.load()
          await ffmpeg.writeFile('input.webm', await fetchFile(new Blob([exportedBuffer], { type: mimeType })))
          await ffmpeg.exec(['-i', 'input.webm', '-c', 'copy', 'output.mp4'])
          const data = await ffmpeg.readFile('output.mp4') as Uint8Array
          // Avoid unnecessary copy if the Uint8Array spans the full ArrayBuffer.
          // Otherwise, slice to ensure IPC writes only the relevant byte range.
          finalBuffer =
            data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
              ? data.buffer
              : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        } catch (e) {
          console.error('MP4 Remux failed, saving as WebM fallback.', e)
          setExportDetail('MP4 conversion failed, saving as WebM instead.')
          // The token path will have a .mp4 extension, but the content will be
          // valid WebM — better than losing the export entirely.
        }
      }

      setExportDetail('Saving export...')
      const saveResult = await window.electronAPI.saveFile(saveToken, finalBuffer)
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save exported file')
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
          <button
            onClick={onClose}
            disabled={exporting}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
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
                  const isSupported = isFormatSupportedForExport(option)
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

          {exporting && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${Math.round(exportProgress * 100)}%` }}
                />
              </div>
              <p className="text-xs text-text-secondary">
                Export progress: {Math.round(exportProgress * 100)}%
              </p>
              {exportDetail && <p className="text-xs text-amber-300">{exportDetail}</p>}
            </div>
          )}

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
