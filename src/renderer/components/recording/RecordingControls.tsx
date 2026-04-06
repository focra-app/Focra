import { Circle, Square, Pause } from 'lucide-react'

interface RecordingControlsProps {
  isRecording: boolean
  isPaused: boolean
  elapsedTime: number
  onStart: () => void
  onStop: () => void
  onPause: () => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function RecordingControls({
  isRecording,
  isPaused,
  elapsedTime,
  onStart,
  onStop,
  onPause
}: RecordingControlsProps) {
  if (!isRecording) {
    return (
      <button
        onClick={onStart}
        className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl font-semibold text-lg transition-colors duration-150 shadow-lg shadow-red-900/30"
      >
        <Circle size={20} fill="white" />
        Start Recording
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {/* Timer */}
      <div className="flex items-center gap-2 bg-bg-tertiary rounded-xl px-4 py-3 flex-1">
        <span className={`w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`} />
        <span className="font-mono text-xl font-semibold text-text-primary">{formatTime(elapsedTime)}</span>
        <span className="text-text-secondary text-sm ml-1">{isPaused ? 'Paused' : 'Recording'}</span>
      </div>

      {/* Pause/Resume */}
      <button
        onClick={onPause}
        className="flex items-center justify-center gap-2 bg-bg-tertiary hover:bg-[#2e2e2e] text-text-primary px-4 py-3 rounded-xl font-medium transition-colors duration-150"
        title={isPaused ? 'Resume' : 'Pause'}
      >
        {isPaused
          ? <Circle size={18} className="text-red-400" />
          : <Pause size={18} />
        }
      </button>

      {/* Stop */}
      <button
        onClick={onStop}
        className="flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 text-white px-4 py-3 rounded-xl font-medium transition-colors duration-150"
        title="Stop Recording"
      >
        <Square size={18} fill="white" />
        Stop
      </button>
    </div>
  )
}
