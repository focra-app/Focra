import { useEffect, useRef } from 'react'
import type { DesktopSource } from '../../types'

interface RecordingPreviewProps {
  source: DesktopSource | null
  stream: MediaStream | null
  isRecording: boolean
}

export default function RecordingPreview({ source, stream, isRecording }: RecordingPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  if (!source) {
    return (
      <div className="aspect-video bg-bg-tertiary rounded-xl flex items-center justify-center border border-border">
        <p className="text-text-muted text-sm">No source selected</p>
      </div>
    )
  }

  if (stream) {
    return (
      <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-border">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain"
        />
        {isRecording && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-xs font-medium">LIVE</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-border">
      <img
        src={source.thumbnail}
        alt={source.name}
        className="w-full h-full object-contain"
      />
    </div>
  )
}
