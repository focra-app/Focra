import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Download,
  ChevronLeft, ZoomIn, Type, Image, Crop, MousePointer
} from 'lucide-react'
import { useEditorStore } from '../store/useEditorStore'
import VideoPreview from '../components/editor/VideoPreview'
import Timeline from '../components/editor/Timeline'
import ZoomEditor from '../components/editor/ZoomEditor'
import AnnotationTools from '../components/editor/AnnotationTools'
import BackgroundPanel from '../components/editor/BackgroundPanel'
import ExportDialog from '../components/editor/ExportDialog'
import type { RecordingResult } from '../types'

interface EditorPageProps {
  result: RecordingResult
  onBack: () => void
}

type RightPanel = 'zoom' | 'annotations' | 'background' | 'crop'

export default function EditorPage({ result, onBack }: EditorPageProps) {
  const { loadProject, project, isPlaying, setCurrentTime, setIsPlaying, setSelectedTool, selectedTool } =
    useEditorStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>('zoom')
  const [showExport, setShowExport] = useState(false)

  useEffect(() => {
    loadProject({
      videoUrl: result.videoUrl,
      duration: result.duration,
      zoomKeyframes: result.zoomKeyframes,
      annotations: [],
      trimPoints: { inPoint: 0, outPoint: result.duration },
      background: { type: 'solid', color: '#1a1a2e' },
      cropSettings: null,
      exportSettings: {
        aspectRatio: '16:9',
        resolution: '1080p',
        format: 'webm',
        fps: 60
      }
    })
  }, [result])

  // Sync video element with store time
  useEffect(() => {
    const video = videoRef.current
    if (!video || !project) return
    video.src = project.videoUrl

    const onTimeUpdate = () => {
      if (!video.paused) {
        setCurrentTime(video.currentTime)
        // Enforce trim out point
        if (video.currentTime >= project.trimPoints.outPoint) {
          video.pause()
          setIsPlaying(false)
          video.currentTime = project.trimPoints.inPoint
          setCurrentTime(project.trimPoints.inPoint)
        }
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [project?.videoUrl, project?.trimPoints.inPoint, project?.trimPoints.outPoint])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      video.pause()
      setIsPlaying(false)
    } else {
      if (video.currentTime >= (project?.trimPoints.outPoint ?? Infinity)) {
        video.currentTime = project?.trimPoints.inPoint ?? 0
      }
      video.play()
      setIsPlaying(true)
    }
  }, [isPlaying, project])

  const handleSkipBack = () => {
    const t = project?.trimPoints.inPoint ?? 0
    if (videoRef.current) videoRef.current.currentTime = t
    setCurrentTime(t)
  }

  const handleSkipForward = () => {
    const t = project?.trimPoints.outPoint ?? (project?.duration ?? 0)
    if (videoRef.current) videoRef.current.currentTime = t
    setCurrentTime(t)
  }

  const rightPanelTabs: { id: RightPanel; icon: typeof ZoomIn; label: string }[] = [
    { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
    { id: 'annotations', icon: Type, label: 'Text' },
    { id: 'background', icon: Image, label: 'BG' },
    { id: 'crop', icon: Crop, label: 'Crop' }
  ]

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top toolbar */}
      <div className="drag-region flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0 bg-bg-secondary">
        <button
          onClick={onBack}
          className="no-drag flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          <ChevronLeft size={16} />
          New Recording
        </button>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Tool selector */}
        <div className="no-drag flex items-center bg-bg-tertiary rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => { setSelectedTool('select'); }}
            className={`p-1.5 rounded-md transition-colors ${selectedTool === 'select' ? 'bg-bg-secondary text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            title="Select"
          >
            <MousePointer size={15} />
          </button>
          <button
            onClick={() => { setSelectedTool('text'); setRightPanel('annotations'); }}
            className={`p-1.5 rounded-md transition-colors ${selectedTool === 'text' ? 'bg-bg-secondary text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            title="Text"
          >
            <Type size={15} />
          </button>
          <button
            onClick={() => { setSelectedTool('crop'); setRightPanel('crop'); }}
            className={`p-1.5 rounded-md transition-colors ${selectedTool === 'crop' ? 'bg-bg-secondary text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            title="Crop"
          >
            <Crop size={15} />
          </button>
        </div>

        <div className="flex-1" />

        {/* Export button */}
        <button
          onClick={() => setShowExport(true)}
          className="no-drag btn-primary flex items-center gap-2 text-sm py-1.5"
        >
          <Download size={15} />
          Export
        </button>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: preview */}
        <div className="flex-1 flex flex-col p-4 gap-3 min-w-0">
          <VideoPreview videoRef={videoRef} />

          {/* Playback controls */}
          <div className="flex items-center justify-center gap-3">
            <button onClick={handleSkipBack} className="text-text-secondary hover:text-text-primary transition-colors" title="Go to in-point">
              <SkipBack size={20} />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center transition-colors shadow-lg shadow-accent/20"
            >
              {isPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
            </button>
            <button onClick={handleSkipForward} className="text-text-secondary hover:text-text-primary transition-colors" title="Go to out-point">
              <SkipForward size={20} />
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-bg-secondary">
          {/* Right panel tabs */}
          <div className="flex border-b border-border">
            {rightPanelTabs.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setRightPanel(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors border-b-2
                  ${rightPanel === id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 p-4 overflow-y-auto">
            {rightPanel === 'zoom' && <ZoomEditor />}
            {rightPanel === 'annotations' && <AnnotationTools />}
            {rightPanel === 'background' && <BackgroundPanel />}
            {rightPanel === 'crop' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Crop size={15} className="text-accent" />
                  <span className="text-sm font-semibold text-text-primary">Crop</span>
                </div>
                <p className="text-xs text-text-muted bg-bg-tertiary rounded-lg p-3">
                  Crop settings adjust the visible area of your recording. Use the X, Y, Width, and Height fields below to define the crop region.
                </p>
                <button
                  onClick={() => useEditorStore.getState().setCrop(null)}
                  className="btn-secondary w-full text-sm"
                >
                  Reset Crop
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {(['x', 'y', 'width', 'height'] as const).map((field) => (
                    <div key={field} className="space-y-1">
                      <span className="label">{field.toUpperCase()}</span>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={(project.cropSettings?.[field] ?? (field === 'width' || field === 'height' ? 1 : 0)).toFixed(2)}
                        onChange={(e) => {
                          const current = project.cropSettings || { x: 0, y: 0, width: 1, height: 1 }
                          useEditorStore.getState().setCrop({ ...current, [field]: parseFloat(e.target.value) })
                        }}
                        className="input-field text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <Timeline videoRef={videoRef} />

      {/* Hidden video element for playback */}
      <video ref={videoRef} className="hidden" preload="auto" />

      {/* Export Dialog */}
      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} videoBlob={result.videoBlob} />
      )}
    </div>
  )
}
