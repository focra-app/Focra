const fs = require('fs')

const path = 'src/renderer/components/editor/ExportDialog.tsx'
let content = fs.readFileSync(path, 'utf8')

// Add import
if (!content.includes('StreamingVideoDecoder')) {
  content = content.replace(
    "import { PixiRenderer } from '../../lib/PixiRenderer'",
    "import { PixiRenderer } from '../../lib/PixiRenderer'\nimport { StreamingVideoDecoder } from '../../lib/StreamingVideoDecoder'"
  )
}

// Remove waitForVideoEvent
content = content.replace(/function waitForVideoEvent\([\s\S]*?\n\}\n/m, '')

// Remove seekToFrame
content = content.replace(/\/\*\*[\s\S]*?async function seekToFrame\([\s\S]*?\n\}\n/m, '')

// Replace renderVideoWithEffects
const renderFuncRegex = /async function renderVideoWithEffects\([\s\S]*?\): Promise<void> \{[\s\S]*?export default function ExportDialog/m;

const newRenderFunc = `async function renderVideoWithEffects(
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
        detail: \`Requested resolution exceeds source quality. Export capped to \${width}×\${height}.\`
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
      const audioRes = await fetch(project.videoUrl)
      const arrayBuffer = await audioRes.arrayBuffer()
      const audioCtx = new window.AudioContext()
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      sampleRate = audioBuffer.sampleRate
      numberOfChannels = audioBuffer.numberOfChannels
    } catch (e) {
      console.warn('Failed to extract audio, proceeding with video only.', e)
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

export default function ExportDialog`;

content = content.replace(renderFuncRegex, newRenderFunc);

fs.writeFileSync(path, content, 'utf8')
console.log('Successfully updated ExportDialog.tsx')
