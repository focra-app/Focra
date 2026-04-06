import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Volume2, Zap } from 'lucide-react'
import SourceSelector from '../components/recording/SourceSelector'
import RecordingControls from '../components/recording/RecordingControls'
import RecordingPreview from '../components/recording/RecordingPreview'
import type { DesktopSource, RecordingResult, ZoomKeyframe } from '../types'

interface MouseEventData {
  x: number
  y: number
  timestamp: number
  type: 'click' | 'move'
}

interface RecordPageProps {
  onRecordingComplete: (result: RecordingResult) => void
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mouseEventsRef = useRef<MouseEventData[]>([])
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const trackMouseEvents = useCallback((e: globalThis.MouseEvent) => {
    if (!isRecording || isPaused) return
    const timestamp = Date.now() - startTimeRef.current
    if (e.type === 'click') {
      mouseEventsRef.current.push({ x: e.screenX, y: e.screenY, timestamp, type: 'click' })
    }
  }, [isRecording, isPaused])

  useEffect(() => {
    window.addEventListener('click', trackMouseEvents)
    return () => window.removeEventListener('click', trackMouseEvents)
  }, [trackMouseEvents])

  const startRecording = async () => {
    if (!selectedSource) return
    setError(null)

    try {
      const displayStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: systemAudioEnabled
          ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSource.id } }
          : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 60
          }
        }
      })

      let combinedStream = displayStream

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
        } catch {
          // Mic not available, continue without it
        }
      }

      streamRef.current = combinedStream
      setStream(combinedStream)

      chunksRef.current = []
      mouseEventsRef.current = []
      startTimeRef.current = Date.now()

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm'
      })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setElapsedTime(0)

      timerRef.current = setInterval(() => {
        setElapsedTime((t) => t + 1)
      }, 1000)
    } catch (err) {
      setError(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return

    mediaRecorderRef.current.onstop = async () => {
      const duration = (Date.now() - startTimeRef.current) / 1000
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const videoUrl = URL.createObjectURL(blob)

      let zoomKeyframes: ZoomKeyframe[] = []
      if (autoZoomEnabled && mouseEventsRef.current.length > 0) {
        try {
          const screenSize = await window.electronAPI.getScreenSize()
          const rawKfs = await window.electronAPI.generateZoomKeyframes(
            mouseEventsRef.current,
            duration,
            screenSize.width,
            screenSize.height
          )
          // Apply sensitivity: filter or adjust scale
          zoomKeyframes = rawKfs
            .filter(() => Math.random() < autoZoomSensitivity)
            .map((kf: ZoomKeyframe) => ({ ...kf, scale: 1 + (kf.scale - 1) * autoZoomSensitivity }))
        } catch {
          zoomKeyframes = []
        }
      }

      onRecordingComplete({ videoUrl, videoBlob: blob, duration, zoomKeyframes })

      streamRef.current?.getTracks().forEach((t) => t.stop())
      setStream(null)
      setIsRecording(false)
      setIsPaused(false)
    }

    mediaRecorderRef.current.stop()
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const togglePause = () => {
    const rec = mediaRecorderRef.current
    if (!rec) return
    if (isPaused) {
      rec.resume()
      timerRef.current = setInterval(() => setElapsedTime((t) => t + 1), 1000)
    } else {
      rec.pause()
      if (timerRef.current) clearInterval(timerRef.current)
    }
    setIsPaused(!isPaused)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="drag-region h-10 flex items-center px-4 flex-shrink-0">
        <div className="no-drag flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-accent" />
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
              <button
                onClick={() => setMicEnabled(!micEnabled)}
                className={`w-10 h-6 rounded-full transition-colors duration-200 relative
                  ${micEnabled ? 'bg-accent' : 'bg-border'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                  ${micEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Volume2 size={15} className="text-text-secondary" />
                System Audio
              </div>
              <button
                onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
                className={`w-10 h-6 rounded-full transition-colors duration-200 relative
                  ${systemAudioEnabled ? 'bg-accent' : 'bg-border'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                  ${systemAudioEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          <div className="panel p-4 space-y-4">
            <p className="label flex items-center gap-2"><Zap size={14} /> Auto-Zoom</p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-primary">Enable Auto-Zoom</span>
              <button
                onClick={() => setAutoZoomEnabled(!autoZoomEnabled)}
                className={`w-10 h-6 rounded-full transition-colors duration-200 relative
                  ${autoZoomEnabled ? 'bg-accent' : 'bg-border'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                  ${autoZoomEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
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
              ? 'Recording in progress — mouse clicks will be tracked for auto-zoom'
              : 'Select a source and press Start Recording'}
          </p>
        </div>
      </div>
    </div>
  )
}
