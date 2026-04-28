import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Volume2, Zap, Video } from 'lucide-react'
import SourceSelector from '../components/recording/SourceSelector'
import RecordingControls from '../components/recording/RecordingControls'
import RecordingPreview from '../components/recording/RecordingPreview'
import type { CaptureBounds, DesktopSource, RecordingResult, ZoomKeyframe } from '../types'
import appLogo from '../assets/focra-logo.svg'

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
  const [recordingResolution, setRecordingResolution] = useState<'auto' | '720p' | '1080p' | '1440p' | '4k'>('auto')
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
    const micAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const systemAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  // Keep ref to the raw display stream so its audio tracks can be stopped on cleanup
  const displayStreamRef = useRef<MediaStream | null>(null)
  // Cleanup function returned by onMouseClick
  const unsubscribeMouseClickRef = useRef<(() => void) | null>(null)
  // Track active recording time, excluding any paused intervals
  const pausedDurationRef = useRef<number>(0)  // accumulated paused ms
  const pauseStartRef = useRef<number>(0)       // timestamp of current pause start
  const captureBoundsRef = useRef<CaptureBounds | null>(null)

  // High-quality preview stream when a source is selected
  useEffect(() => {
    let active = true
    let previewStream: MediaStream | null = null

    const stopPreview = () => {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop())
        previewStream = null
      }
    }

    const startPreview = async () => {
      if (!selectedSource || isRecording) {
        setStream(null)
        return
      }

      try {
        const captureBounds = await window.electronAPI.getSourceBounds(selectedSource.id, selectedSource.displayId)
        if (!active || isRecording) return

        const clampedWidth = captureBounds.width; const clampedHeight = captureBounds.height;

        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selectedSource.id,
            },
            width: { ideal: clampedWidth },
            height: { ideal: clampedHeight },
            frameRate: { ideal: 30, max: 60 }
          } as any
        })

        if (active && !isRecording) {
          stopPreview()
          previewStream = s
          setStream(s)
        } else {
          s.getTracks().forEach((t) => t.stop())
        }
      } catch (err) {
        console.error('Failed to start preview stream:', err)
        if (active) setStream(null)
      }
    }

    startPreview()

    return () => {
      active = false
      stopPreview()
    }
  }, [selectedSource, isRecording, recordingResolution])

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
      const autoZoomTrackingEnabled = autoZoomEnabled && selectedSource.id.startsWith('screen')
      const captureBounds = await window.electronAPI.getSourceBounds(selectedSource.id, selectedSource.displayId)
      captureBoundsRef.current = captureBounds

      const clampedWidth = captureBounds.width; const clampedHeight = captureBounds.height;

      const displayStream = await navigator.mediaDevices.getUserMedia({
        audio: systemAudioEnabled
          ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource.id } }
          : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id,
          },
          width: { ideal: clampedWidth },
          height: { ideal: clampedHeight },
          frameRate: { ideal: 30, max: 60 }
        } as any
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
            micAudioTrackRef.current = null
      systemAudioTrackRef.current = null
      displayStreamRef.current = displayStream

      if (!systemAudioEnabled) {
        // Some desktop-capture setups may still return an audio track despite audio:false.
        // Explicitly remove it so the System Audio toggle is always respected.
        for (const track of displayStream.getAudioTracks()) {
          displayStream.removeTrack(track)
          track.stop()
        }
      }

      let micTrack: MediaStreamTrack | null = null
      if (micEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          micStreamRef.current = micStream
          micTrack = micStream.getAudioTracks()[0] ?? null
          micAudioTrackRef.current = micTrack
        } catch {
          // Mic not available, continue without it
        }
      }

      const systemTrack = displayStream.getAudioTracks()[0] ?? null
      systemAudioTrackRef.current = systemTrack

      if (micTrack || systemTrack) {
        const audioContext = new AudioContext()
        const dest = audioContext.createMediaStreamDestination()

        if (systemTrack) {
          const sysSource = audioContext.createMediaStreamSource(new MediaStream([systemTrack]))
          sysSource.connect(dest)
        }

        if (micTrack) {
          const micSource = audioContext.createMediaStreamSource(new MediaStream([micTrack]))
          micSource.connect(dest)
        }

        audioContextRef.current = audioContext
        const mixedTrack = dest.stream.getAudioTracks()[0]
        combinedStream = mixedTrack
          ? new MediaStream([...displayStream.getVideoTracks(), mixedTrack])
          : new MediaStream([...displayStream.getVideoTracks()])
      } else {
        combinedStream = new MediaStream([...displayStream.getVideoTracks()])
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
      if (autoZoomTrackingEnabled) {
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
          const normalizedSensitivity = Math.max(0.1, Math.min(1, autoZoomSensitivity))
          // Lower sensitivity = fewer keyframes by requiring larger spacing between events.
          const minGapSeconds = 0.5 + (1 - normalizedSensitivity) * 2.5
          // Lower sensitivity = subtler zoom scale.
          const scaleFactor = 0.45 + normalizedSensitivity * 0.9

          let lastAcceptedTime = -Infinity
          zoomKeyframes = rawKfs
            .filter((kf: ZoomKeyframe) => {
              if (kf.time - lastAcceptedTime < minGapSeconds) {
                return false
              }
              lastAcceptedTime = kf.time
              return true
            })
            .map((kf: ZoomKeyframe) => ({
              ...kf,
              scale: Math.max(1.0, Math.min(3.5, 1 + (kf.scale - 1) * scaleFactor))
            }))
        } catch {
          zoomKeyframes = []
        }
      }

      onRecordingComplete({ videoUrl, videoBlob: blob, duration, zoomKeyframes, captureWidth: clampedWidth, captureHeight: clampedHeight })

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
              src={appLogo}
              alt="Focra logo"
              className="w-5 h-5 object-contain"
              onError={() => setLogoLoadFailed(true)}
            />
          )}
          <span className="text-sm font-semibold text-text-primary">Focra</span>
        </div>
      </div>

      <div className="flex flex-1 gap-4 p-4 pt-0 overflow-hidden">
        {/* Left panel: settings */}
        <div className="w-80 flex flex-col gap-3 flex-shrink-0 overflow-y-auto pr-1">
          <div className="panel p-3.5 space-y-3">
            <SourceSelector selected={selectedSource} onSelect={setSelectedSource} />
          </div>

          <div className="panel p-3.5 space-y-3">
            <p className="label flex items-center gap-2"><Video size={14} /> Video Settings</p>
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider opacity-80">Recording Resolution</span>
              <div className="grid grid-cols-5 gap-1">
                {(['auto', '720p', '1080p', '1440p', '4k'] as const).map((res) => (
                  <button
                    key={res}
                    onClick={() => setRecordingResolution(res)}
                    className={`px-1 py-1.5 rounded-md border text-[9px] font-bold uppercase transition-all
                      ${recordingResolution === res
                        ? 'bg-accent border-accent text-white shadow-sm'
                        : 'bg-bg-tertiary border-border text-text-secondary hover:border-text-muted'}`}
                  >
                    {res}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-text-muted leading-tight opacity-80">
                {recordingResolution === 'auto'
                  ? 'Captures at the source\'s native resolution.'
                  : `Captures at ${resolutionMap[recordingResolution].width}x${resolutionMap[recordingResolution].height}. Upscaling may affect quality.`}
              </p>
            </div>
          </div>

          <div className="panel p-3.5 space-y-3">
            <p className="label flex items-center gap-2"><Mic size={14} /> Audio Settings</p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Mic size={15} className="text-text-secondary" />
                Microphone
              </div>
              <ToggleSwitch
                enabled={micEnabled}
                label="Microphone"
                onToggle={() => {
                  if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
                    if (micAudioTrackRef.current) {
                      micAudioTrackRef.current.enabled = !micAudioTrackRef.current.enabled;
                      setMicEnabled(micAudioTrackRef.current.enabled);
                    }
                  } else {
                    setMicEnabled(prev => !prev);
                  }
                }}
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
                onToggle={() => {
                  if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
                    if (systemAudioTrackRef.current) {
                      systemAudioTrackRef.current.enabled = !systemAudioTrackRef.current.enabled;
                      setSystemAudioEnabled(systemAudioTrackRef.current.enabled);
                    }
                  } else {
                    setSystemAudioEnabled(prev => !prev);
                  }
                }}
              />
            </div>
          </div>

          <div className="panel p-3.5 space-y-3">
            <p className="label flex items-center gap-2"><Zap size={14} /> Auto-Zoom</p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-primary">Enable Auto-Zoom</span>
              <ToggleSwitch
                enabled={autoZoomEnabled}
                label="Enable Auto-Zoom"
                onToggle={() => setAutoZoomEnabled((prev) => !prev)}
              />
            </div>

            {autoZoomEnabled && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Sensitivity</span>
                  <span className="text-xs text-text-secondary font-mono">{Math.round(autoZoomSensitivity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={autoZoomSensitivity}
                  onChange={(e) => setAutoZoomSensitivity(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
                />
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
