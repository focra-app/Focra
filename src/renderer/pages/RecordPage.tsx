import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Volume2, Zap } from 'lucide-react'
import SourceSelector from '../components/recording/SourceSelector'
import RecordingControls from '../components/recording/RecordingControls'
import RecordingPreview from '../components/recording/RecordingPreview'
import type { CaptureBounds, DesktopSource, RecordingResult, ZoomKeyframe } from '../types'

interface MouseEventData {
  x: number
  y: number
  timestamp: number
  type: 'click' | 'move'
}

const TARGET_FRAME_RATE = 60
const MIN_CAPTURE_WIDTH = 1280
const MIN_CAPTURE_HEIGHT = 720
const MAX_CAPTURE_WIDTH = 7680
const MAX_CAPTURE_HEIGHT = 4320
const MIN_VIDEO_BITRATE = 8_000_000
const MAX_VIDEO_BITRATE = 45_000_000
const VIDEO_BITS_PER_PIXEL_PER_FRAME = 0.1
const AUDIO_BITRATE = 128_000
const TOGGLE_WIDTH = 44
const TOGGLE_HEIGHT = 24
const TOGGLE_EDGE_OFFSET = 4
const TOGGLE_KNOB_SIZE = 16
const TOGGLE_TRAVEL = TOGGLE_WIDTH - TOGGLE_KNOB_SIZE - TOGGLE_EDGE_OFFSET * 2
const APP_LOGO_URL = 'https://github.com/user-attachments/assets/d63e04bd-75ca-40f3-8d59-7ba1a1cff262'

interface RecordPageProps {
  onRecordingComplete: (result: RecordingResult) => void
}

interface ToggleSwitchProps {
  enabled: boolean
  onToggle: () => void
  label: string
}

function ToggleSwitch({ enabled, onToggle, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex flex-shrink-0 items-center rounded-full transition-colors duration-200
        ${enabled ? 'bg-accent' : 'bg-border'}`}
      style={{ width: TOGGLE_WIDTH, height: TOGGLE_HEIGHT }}
    >
      <span
        className="absolute rounded-full bg-white shadow transition-transform duration-200"
        style={{
          top: TOGGLE_EDGE_OFFSET,
          left: TOGGLE_EDGE_OFFSET,
          width: TOGGLE_KNOB_SIZE,
          height: TOGGLE_KNOB_SIZE,
          transform: `translateX(${enabled ? TOGGLE_TRAVEL : 0}px)`
        }}
      />
    </button>
  )
}

export default function RecordPage({ onRecordingComplete }: RecordPageProps) {
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true)
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true)
  const [autoZoomSensitivity, setAutoZoomSensitivity] = useState(0.7)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logoLoadFailed, setLogoLoadFailed] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mouseEventsRef = useRef<MouseEventData[]>([])
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Refs for proper cleanup of mic mixing resources
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  // Keep ref to the raw display stream so its audio tracks can be stopped on cleanup
  const displayStreamRef = useRef<MediaStream | null>(null)
  // Cleanup function returned by onMouseClick
  const unsubscribeMouseClickRef = useRef<(() => void) | null>(null)
  // Track active recording time, excluding any paused intervals
  const pausedDurationRef = useRef<number>(0)  // accumulated paused ms
  const pauseStartRef = useRef<number>(0)       // timestamp of current pause start
  const captureBoundsRef = useRef<CaptureBounds | null>(null)

  // Clean up mouse tracking subscription on unmount
  useEffect(() => {
    return () => {
      unsubscribeMouseClickRef.current?.()
    }
  }, [])

  const startRecording = async () => {
    if (!selectedSource) return
    setError(null)

    try {
      const captureBounds = await window.electronAPI.getSourceBounds(selectedSource.id, selectedSource.displayId)
      captureBoundsRef.current = captureBounds
      const clampedWidth = Math.max(MIN_CAPTURE_WIDTH, Math.min(MAX_CAPTURE_WIDTH, captureBounds.width))
      const clampedHeight = Math.max(MIN_CAPTURE_HEIGHT, Math.min(MAX_CAPTURE_HEIGHT, captureBounds.height))

      const displayStream = await navigator.mediaDevices.getUserMedia({
        audio: systemAudioEnabled
          ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource.id } }
          : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id,
            maxWidth: clampedWidth,
            maxHeight: clampedHeight,
            maxFrameRate: TARGET_FRAME_RATE
          }
        }
      })
      const videoTrack = displayStream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error('Unable to start recording: no video track was returned for the selected source.')
      }
      const trackSettings = videoTrack.getSettings()
      const resolvedWidth = Math.max(1, Math.round(trackSettings?.width ?? clampedWidth))
      const resolvedHeight = Math.max(1, Math.round(trackSettings?.height ?? clampedHeight))
      const resolvedFrameRate = Math.max(1, Math.round(trackSettings?.frameRate ?? TARGET_FRAME_RATE))
      const pixelRate = resolvedWidth * resolvedHeight * resolvedFrameRate
      const videoBitsPerSecond = Math.min(
        MAX_VIDEO_BITRATE,
        Math.max(MIN_VIDEO_BITRATE, Math.round(pixelRate * VIDEO_BITS_PER_PIXEL_PER_FRAME))
      )

      let combinedStream = displayStream
      micStreamRef.current = null
      audioContextRef.current = null
      displayStreamRef.current = displayStream

      if (micEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const audioContext = new AudioContext()
          const dest = audioContext.createMediaStreamDestination()
          const micSource = audioContext.createMediaStreamSource(micStream)
          micSource.connect(dest)
          if (displayStream.getAudioTracks().length > 0) {
            const sysSource = audioContext.createMediaStreamSource(displayStream)
            sysSource.connect(dest)
          }
          combinedStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...dest.stream.getTracks()
          ])
          // Keep references for cleanup
          micStreamRef.current = micStream
          audioContextRef.current = audioContext
        } catch {
          // Mic not available, continue without it
        }
      }

      streamRef.current = combinedStream
      setStream(combinedStream)

      chunksRef.current = []
      mouseEventsRef.current = []
      pausedDurationRef.current = 0
      pauseStartRef.current = 0
      const recordingStartTime = Date.now()
      startTimeRef.current = recordingStartTime

      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(combinedStream, {
          mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : 'video/webm',
          videoBitsPerSecond,
          audioBitsPerSecond: AUDIO_BITRATE
        })

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.start(1000)
      } catch (recorderError) {
        // MediaRecorder construction/start failed — clean up all acquired resources
        cancelRecordingResources()
        throw recorderError
      }

      mediaRecorderRef.current = recorder

      // Start global mouse tracking in the main process so clicks in other
      // app windows (i.e. the recorded screen) are captured for auto-zoom.
      if (autoZoomEnabled) {
        unsubscribeMouseClickRef.current?.()
        try {
          unsubscribeMouseClickRef.current = window.electronAPI.onMouseClick((data) => {
            if (mediaRecorderRef.current?.state === 'recording') {
              // Normalize the timestamp to active recording time by subtracting any
              // accumulated paused duration so keyframes align with the WebM timeline.
              const normalizedTimestamp = Math.max(0, data.timestamp - pausedDurationRef.current)
              mouseEventsRef.current.push({ ...data, timestamp: normalizedTimestamp, type: 'click' })
            }
          })
          await window.electronAPI.startMouseTracking(recordingStartTime, captureBounds)
        } catch (mouseTrackingError) {
          // Mouse tracking failed — tear down the recorder and all acquired resources
          unsubscribeMouseClickRef.current?.()
          unsubscribeMouseClickRef.current = null
          window.electronAPI.stopMouseTracking()
          cancelRecordingResources()
          throw mouseTrackingError
        }
      }

      setIsRecording(true)
      setElapsedTime(0)

      timerRef.current = setInterval(() => {
        setElapsedTime((t) => t + 1)
      }, 1000)
    } catch (err) {
      setError(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const cleanupAudio = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    // Stop any display-stream audio tracks that were routed through the AudioContext
    // (they're not part of combinedStream so they wouldn't be stopped otherwise)
    displayStreamRef.current?.getAudioTracks().forEach((t) => t.stop())
    displayStreamRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
  }, [])

  // Shared helper: stop the recorder, all stream tracks, audio resources, and reset state.
  // Called from error paths in startRecording and from stopRecording.
  const cancelRecordingResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop() } catch { /* already stopped */ }
      mediaRecorderRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    // Explicitly stop all display-stream and mic tracks in case any were not
    // added to combinedStream (e.g. display audio tracks when mic mixing is active)
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    // Reset pause tracking so the next recording starts fresh
    pausedDurationRef.current = 0
    pauseStartRef.current = 0
    captureBoundsRef.current = null
    cleanupAudio()
    setStream(null)
    setIsRecording(false)
    setIsPaused(false)
  }, [cleanupAudio])

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return

    // Stop global mouse tracking immediately
    window.electronAPI.stopMouseTracking()
    unsubscribeMouseClickRef.current?.()
    unsubscribeMouseClickRef.current = null

    mediaRecorderRef.current.onstop = async () => {
      // Compute active recording time, excluding any time spent paused
      const totalElapsed = Date.now() - startTimeRef.current
      // If the recording was paused when stop() was called, count that segment too
      const finalPausedMs =
        pauseStartRef.current > 0
          ? pausedDurationRef.current + (Date.now() - pauseStartRef.current)
          : pausedDurationRef.current
      const duration = (totalElapsed - finalPausedMs) / 1000
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const videoUrl = URL.createObjectURL(blob)

      let zoomKeyframes: ZoomKeyframe[] = []
      if (autoZoomEnabled && mouseEventsRef.current.length > 0) {
        try {
          const captureBounds = captureBoundsRef.current
          if (!captureBounds) throw new Error('Missing capture bounds for auto-zoom generation')
          const rawKfs = await window.electronAPI.generateZoomKeyframes(
            mouseEventsRef.current,
            duration,
            captureBounds
          )
          // Apply sensitivity: filter by spacing and clamp scale
          zoomKeyframes = rawKfs
            .filter((_kf: ZoomKeyframe, i: number) => {
              // Deterministic: keep every Nth keyframe based on sensitivity
              const keepEvery = Math.max(1, Math.round(1 / autoZoomSensitivity))
              return i % keepEvery === 0
            })
            .map((kf: ZoomKeyframe) => ({ ...kf, scale: 1 + (kf.scale - 1) * autoZoomSensitivity }))
        } catch {
          zoomKeyframes = []
        }
      }

      onRecordingComplete({ videoUrl, videoBlob: blob, duration, zoomKeyframes })

      cancelRecordingResources()
    }

    mediaRecorderRef.current.stop()
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const togglePause = () => {
    const rec = mediaRecorderRef.current
    if (!rec) return

    const currentState = rec.state

    if (currentState === 'paused') {
      // Accumulate the duration of the pause we're ending
      if (pauseStartRef.current > 0) {
        pausedDurationRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = 0
      }
      rec.resume()
      // Always clear any stale interval before starting a new one
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => setElapsedTime((t) => t + 1), 1000)
      setIsPaused(false)
    } else if (currentState === 'recording') {
      // Mark the start of this pause
      pauseStartRef.current = Date.now()
      rec.pause()
      if (timerRef.current) clearInterval(timerRef.current)
      setIsPaused(true)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="drag-region h-10 flex items-center px-4 flex-shrink-0">
        <div className="no-drag flex items-center gap-2">
          {logoLoadFailed ? (
            <div className="w-3 h-3 rounded-full bg-accent" />
          ) : (
            <img
              src={APP_LOGO_URL}
              alt="Focra logo"
              className="w-5 h-5 object-contain"
              referrerPolicy="no-referrer"
              onError={() => setLogoLoadFailed(true)}
            />
          )}
          <span className="text-sm font-semibold text-text-primary">Focra</span>
        </div>
      </div>

      <div className="flex flex-1 gap-4 p-4 pt-0 overflow-hidden">
        {/* Left panel: settings */}
        <div className="w-80 flex flex-col gap-4 flex-shrink-0 overflow-y-auto">
          <div className="panel p-4 space-y-4">
            <SourceSelector selected={selectedSource} onSelect={setSelectedSource} />
          </div>

          <div className="panel p-4 space-y-4">
            <p className="label flex items-center gap-2"><Mic size={14} /> Audio Settings</p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Mic size={15} className="text-text-secondary" />
                Microphone
              </div>
              <ToggleSwitch
                enabled={micEnabled}
                label="Microphone"
                onToggle={() => setMicEnabled(!micEnabled)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Volume2 size={15} className="text-text-secondary" />
                System Audio
              </div>
              <ToggleSwitch
                enabled={systemAudioEnabled}
                label="System Audio"
                onToggle={() => setSystemAudioEnabled(!systemAudioEnabled)}
              />
            </div>
          </div>

          <div className="panel p-4 space-y-4">
            <p className="label flex items-center gap-2"><Zap size={14} /> Auto-Zoom</p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-primary">Enable Auto-Zoom</span>
              <ToggleSwitch
                enabled={autoZoomEnabled}
                label="Enable Auto-Zoom"
                onToggle={() => setAutoZoomEnabled(!autoZoomEnabled)}
              />
            </div>

            {autoZoomEnabled && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Sensitivity</span>
                  <span className="text-xs text-text-secondary">{Math.round(autoZoomSensitivity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={autoZoomSensitivity}
                  onChange={(e) => setAutoZoomSensitivity(parseFloat(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <p className="text-xs text-text-muted">Higher = more zoom events detected</p>
              </div>
            )}
          </div>

          {error && (
            <div className="panel p-3 border-red-800 bg-red-950/30">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Main area: preview + controls */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <RecordingPreview
            source={selectedSource}
            stream={stream}
            isRecording={isRecording}
          />
          <RecordingControls
            isRecording={isRecording}
            isPaused={isPaused}
            elapsedTime={elapsedTime}
            onStart={startRecording}
            onStop={stopRecording}
            onPause={togglePause}
          />
          <p className="text-xs text-text-muted text-center">
            {isRecording
              ? 'Recording in progress — cursor dwell events tracked for auto-zoom'
              : 'Select a source and press Start Recording'}
          </p>
        </div>
      </div>
    </div>
  )
}
