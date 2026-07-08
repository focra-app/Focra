import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer'
import { useState } from 'react'
import { Download, X, Check } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { getZoomTransformAtTime, getZoomTransformFromKeyframe, type ZoomTransform } from './zoomTransform'
import { PixiRenderer } from '../../lib/PixiRenderer'
import { StreamingVideoDecoder } from '../../lib/StreamingVideoDecoder'
import type { EditorProject, ExportSettings, ZoomKeyframe } from '../../types'

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

function isFormatSupportedForExport(_option: ExportFormatOption) {
  return true
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
    let timeoutId: number | undefined

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

/**
 * Seek `video` to `time` and wait until the decoded frame is ready for
 * drawImage. Uses the 'seeked' event, which is the correct signal for a
 * *paused* video element — requestVideoFrameCallback only fires during active
 * playback and would time-out every frame on a paused element.
 *
 * One rAF tick after 'seeked' gives the browser a chance to composite the
 * decoded pixel data into the element before we call drawImage.
 */
async function seekToFrame(video: HTMLVideoElement, time: number): Promise<void> {
  // Already at this timestamp with data available — nothing to do.
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      video.removeEventListener('error', onError)
      reject(new Error('Timed out waiting for decoded video frame'))
    }, MEDIA_EVENT_TIMEOUT_MS)

    const onError = () => {
      window.clearTimeout(timeoutId)
      reject(new Error('Video error during seek'))
    }

    // 'seeked' fires when the seek has completed and the frame at currentTime
    // is decoded. One rAF tick lets the compositor finish painting it.
    video.addEventListener('seeked', () => {
      requestAnimationFrame(() => {
        window.clearTimeout(timeoutId)
        video.removeEventListener('error', onError)
        resolve()
      })
    }, { once: true })

    video.addEventListener('error', onError, { once: true })
    video.currentTime = time
  })
}

async function loadBackgroundImage(project: EditorProject): Promise<HTMLImageElement | null> {
  const { background } = project
  if (background.type !== 'image' || !background.imageUrl) return null

  const image = new Image()
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    // Set src after listeners are attached to avoid missing a cached load event.
    image.src = background.imageUrl || ''
  })

  return loaded ? image : null
}



async function renderVideoWithEffects(
  project: EditorProject,
  settings: ExportSettings,
  saveToken: string,
  onProgress?: (update: ExportProgressUpdate) => void
): Promise<void> {
  const decoder = new StreamingVideoDecoder()

  try {
    // 1. Load metadata
    onProgress?.({ progress: 0, detail: 'Loading video metadata...' })
    const metadata = await decoder.loadMetadata(project.videoUrl)
    
    const mediaDuration = metadata.duration
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
      metadata.width,
      metadata.height
    )
    if (wasClamped) {
      onProgress?.({
        progress: 0,
        detail: `Requested resolution exceeds source quality. Export capped to ${width}×${height}.`
      })
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const renderer = new PixiRenderer()
    await renderer.init(canvas, { width, height })

    const bgImage = await loadBackgroundImage(project)

    const frameDuration = 1 / settings.fps
    const totalFrames = Math.ceil(totalDuration / frameDuration)

    const getSequentialZoomTransform = createSequentialZoomTransformGetter(project.zoomKeyframes)
    const sortedAnnotations = [...project.annotations].sort((a, b) => a.time - b.time)
    let nextAnnotationIndex = 0
    let visibleAnnotations: EditorProject['annotations'] = []

    // 2. Fetch original audio to get metadata for Muxer
    onProgress?.({ progress: 0, detail: 'Extracting audio...' })
    let audioBuffer: AudioBuffer | null = null
    let sampleRate = 44100
    let numberOfChannels = 2
    
    try {
      let audioCtx: AudioContext | null = null
      try {
        const audioRes = await fetch(project.videoUrl)
        const arrayBuffer = await audioRes.arrayBuffer()
        audioCtx = new window.AudioContext()
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
        sampleRate = audioBuffer.sampleRate
        numberOfChannels = audioBuffer.numberOfChannels
      } catch (e) {
        console.warn('Failed to extract audio, proceeding with video only.', e)
      } finally {
        if (audioCtx) {
          audioCtx.close()
        }
      }
    } catch (e) {
      // Catch any unexpected top-level errors just in case
      console.warn('Unexpected error extracting audio.', e)
    }

    // 3. Initialize Muxer and Encoders
    const isMp4 = settings.format === 'mp4'
    const muxer = isMp4
      ? new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: 'avc', width, height },
          audio: audioBuffer ? { codec: 'aac', numberOfChannels, sampleRate } : undefined,
          fastStart: 'in-memory'
        })
      : new WebMMuxer({
          target: new WebMArrayBufferTarget(),
          video: { codec: 'V_VP9', width, height },
          audio: audioBuffer ? { codec: 'V_OPUS', numberOfChannels, sampleRate } : undefined
        })

    let encoderError: Error | null = null
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (isMp4) {
          (muxer as Muxer<ArrayBufferTarget>).addVideoChunk(chunk, meta)
        } else {
          (muxer as WebMMuxer<WebMArrayBufferTarget>).addVideoChunk(chunk, meta)
        }
      },
      error: (e) => {
        encoderError = e
      }
    })

    videoEncoder.configure({
      codec: isMp4 ? 'avc1.4d002a' : 'vp09.00.10.08',
      width,
      height,
      framerate: settings.fps,
      bitrate: 8_000_000
    })

    // 4. Encode audio if present
    if (audioBuffer) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (isMp4) {
            (muxer as Muxer<ArrayBufferTarget>).addAudioChunk(chunk, meta)
          } else {
            (muxer as WebMMuxer<WebMArrayBufferTarget>).addAudioChunk(chunk, meta)
          }
        },
        error: (e) => {
          encoderError = e
        }
      })
      
      audioEncoder.configure({
        codec: isMp4 ? 'mp4a.40.2' : 'opus',
        sampleRate,
        numberOfChannels,
        bitrate: 128_000
      })

      const frameSize = isMp4 ? 1024 : 960
      const startOffset = Math.floor(startTime * sampleRate)
      const endOffset = Math.floor(endTime * sampleRate)
      const trimAudioLength = endOffset - startOffset
      
      for (let offset = 0; offset < trimAudioLength; offset += frameSize) {
        const chunkLength = Math.min(frameSize, trimAudioLength - offset)
        const buffer = new Float32Array(chunkLength * numberOfChannels)
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel)
          buffer.set(channelData.subarray(startOffset + offset, startOffset + offset + chunkLength), channel * chunkLength)
        }
        
        const timestamp = (offset / sampleRate) * 1_000_000
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: chunkLength,
          numberOfChannels,
          timestamp,
          data: buffer
        })
        audioEncoder.encode(audioData)
        audioData.close()
      }
      
      await audioEncoder.flush()
    }

    if (encoderError) throw encoderError

    // 5. Render frames and encode video
    let currentFrameIndex = 0;

    await decoder.decodeAll(
      settings.fps,
      { inPoint: startTime, outPoint: endTime },
      async (frame: VideoFrame, exportTimestampUs: number, sourceTimestampMs: number) => {
        const frameTime = sourceTimestampMs / 1000

        const annotationUpdate = computeVisibleAnnotationsForTime(
          sortedAnnotations,
          visibleAnnotations,
          nextAnnotationIndex,
          frameTime
        )
        nextAnnotationIndex = annotationUpdate.nextAnnotationIndex
        visibleAnnotations = annotationUpdate.visibleAnnotations

        renderer.drawFrame(project, frameTime, frame, bgImage, width, height, {
          zoomTransform: getSequentialZoomTransform(frameTime),
          visibleAnnotations
        })

        const canvasFrame = new VideoFrame(canvas, { timestamp: exportTimestampUs })
        const keyFrame = currentFrameIndex % (settings.fps * 2) === 0 // Keyframe every 2 seconds
        
        videoEncoder.encode(canvasFrame, { keyFrame })
        canvasFrame.close()
        frame.close() // Close the original frame from decoder

        if (encoderError) throw encoderError

        if (currentFrameIndex % 5 === 0) {
          await new Promise(r => setTimeout(r, 0)) // Yield to UI
        }
        
        currentFrameIndex++;
        onProgress?.({ progress: (currentFrameIndex / totalFrames) * 0.9, detail: 'Encoding frames...' })
      },
      (warningMsg) => {
        console.warn(warningMsg)
      }
    )

    onProgress?.({ progress: 0.95, detail: 'Finalizing video...' })
    await videoEncoder.flush()
    if (isMp4) {
      (muxer as Muxer<ArrayBufferTarget>).finalize()
    } else {
      (muxer as WebMMuxer<WebMArrayBufferTarget>).finalize()
    }
    
    const finalBuffer = isMp4 
      ? (muxer as Muxer<ArrayBufferTarget>).target.buffer 
      : (muxer as WebMMuxer<WebMArrayBufferTarget>).target.buffer

    onProgress?.({ progress: 0.99, detail: 'Saving file...' })
    renderer.destroy()
    const res = await window.electronAPI.saveFile(saveToken, finalBuffer)
    if (!res.success) throw new Error(res.error || 'Failed to save video')

    onProgress?.({ progress: 1, detail: 'Export complete!' })

  } finally {
    decoder.destroy()
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

      const expectedExtension = filteredOption.extension

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

      setExportDetail('Rendering frames...')
      await renderVideoWithEffects(
        project,
        { ...settings, format: filteredOption.value },
        saveToken,
        ({ progress, detail }) => {
          setExportProgress(Math.max(0, Math.min(1, progress)))
          if (detail) setExportDetail(detail)
        }
      )

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
