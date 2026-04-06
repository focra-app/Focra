import { useRef, useCallback, useEffect } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { ZoomIn, Scissors } from 'lucide-react'

const PIXELS_PER_SECOND = 80
const RULER_HEIGHT = 24
const TRACK_HEIGHT = 48
const ZOOM_TRACK_HEIGHT = 32
const ANNOTATION_TRACK_HEIGHT = 28

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface TimelineProps {
  videoRef: React.RefObject<HTMLVideoElement>
}

export default function Timeline({ videoRef }: TimelineProps) {
  const { project, currentTime, selectedZoomId, setCurrentTime, setTrimPoints, selectZoom, updateZoom } =
    useEditorStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingPlayhead = useRef(false)
  const isDraggingTrimIn = useRef(false)
  const isDraggingTrimOut = useRef(false)
  const isDraggingZoom = useRef<string | null>(null)
  const dragStartX = useRef(0)
  const dragStartTime = useRef(0)

  if (!project) return null

  const duration = project.duration
  const totalWidth = duration * PIXELS_PER_SECOND
  const { inPoint, outPoint } = project.trimPoints

  const timeFromX = (clientX: number) => {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    const scrollLeft = container.scrollLeft
    const x = clientX - rect.left + scrollLeft
    return Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND))
  }

  const handleMouseDown = useCallback((e: React.MouseEvent, type: string, id?: string) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartX.current = e.clientX
    if (type === 'playhead') {
      isDraggingPlayhead.current = true
      dragStartTime.current = currentTime
    } else if (type === 'trimIn') {
      isDraggingTrimIn.current = true
      dragStartTime.current = inPoint
    } else if (type === 'trimOut') {
      isDraggingTrimOut.current = true
      dragStartTime.current = outPoint
    } else if (type === 'zoom' && id) {
      isDraggingZoom.current = id
      const kf = project.zoomKeyframes.find((k) => k.id === id)
      dragStartTime.current = kf?.time ?? 0
      selectZoom(id)
    }
  }, [currentTime, inPoint, outPoint, project, selectZoom])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const t = timeFromX(e.clientX)
      if (isDraggingPlayhead.current) {
        setCurrentTime(t)
        if (videoRef.current) videoRef.current.currentTime = t
      } else if (isDraggingTrimIn.current) {
        setTrimPoints({ inPoint: Math.min(t, outPoint - 0.5), outPoint })
      } else if (isDraggingTrimOut.current) {
        setTrimPoints({ inPoint, outPoint: Math.max(t, inPoint + 0.5) })
      } else if (isDraggingZoom.current) {
        const id = isDraggingZoom.current
        const dx = e.clientX - dragStartX.current
        const dt = dx / PIXELS_PER_SECOND
        const newTime = Math.max(0, Math.min(duration, dragStartTime.current + dt))
        updateZoom(id, { time: newTime })
      }
    }
    const onMouseUp = () => {
      isDraggingPlayhead.current = false
      isDraggingTrimIn.current = false
      isDraggingTrimOut.current = false
      isDraggingZoom.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [inPoint, outPoint, duration, setCurrentTime, setTrimPoints, updateZoom, videoRef])

  // Ruler ticks
  const ticks: number[] = []
  const majorStep = duration > 60 ? 10 : duration > 30 ? 5 : 2
  for (let t = 0; t <= duration; t += majorStep) ticks.push(t)

  const playheadX = currentTime * PIXELS_PER_SECOND
  const inX = inPoint * PIXELS_PER_SECOND
  const outX = outPoint * PIXELS_PER_SECOND

  return (
    <div className="flex flex-col bg-bg-secondary border-t border-border select-none" style={{ height: 180 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
        <Scissors size={13} className="text-text-secondary" />
        <span className="text-xs text-text-secondary font-medium">Timeline</span>
        <span className="text-xs text-text-muted ml-2">{formatTime(currentTime)}</span>
      </div>

      {/* Scrollable timeline */}
      <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden relative">
        <div style={{ width: totalWidth + 80, position: 'relative', minHeight: '100%' }}>
          {/* Ruler */}
          <div
            className="absolute top-0 left-0 right-0 bg-bg-tertiary border-b border-border"
            style={{ height: RULER_HEIGHT, zIndex: 2 }}
            onMouseDown={(e) => {
              const t = timeFromX(e.clientX)
              setCurrentTime(t)
              if (videoRef.current) videoRef.current.currentTime = t
              isDraggingPlayhead.current = true
            }}
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute flex flex-col items-center"
                style={{ left: t * PIXELS_PER_SECOND }}
              >
                <div className="w-px h-3 bg-border mt-1" />
                <span className="text-[10px] text-text-muted mt-0.5">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          {/* Trim overlay: dim trimmed areas */}
          <div
            className="absolute bg-bg-primary/60 pointer-events-none"
            style={{ top: RULER_HEIGHT, left: 0, width: inX, bottom: 0, zIndex: 1 }}
          />
          <div
            className="absolute bg-bg-primary/60 pointer-events-none"
            style={{ top: RULER_HEIGHT, left: outX, right: 0, bottom: 0, zIndex: 1 }}
          />

          {/* Video clip track */}
          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT, height: TRACK_HEIGHT }}
          >
            {/* Clip bar */}
            <div
              className="absolute bg-accent/30 border border-accent/50 rounded overflow-hidden"
              style={{ left: 0, width: totalWidth, top: 6, height: TRACK_HEIGHT - 12 }}
            >
              <div className="h-full flex items-center px-2">
                <span className="text-[10px] text-accent truncate">Video Clip</span>
              </div>
            </div>

            {/* Trim In handle */}
            <div
              className="absolute top-0 bottom-0 w-3 bg-accent cursor-ew-resize rounded-l flex items-center justify-center"
              style={{ left: inX - 6, zIndex: 3 }}
              onMouseDown={(e) => handleMouseDown(e, 'trimIn')}
            >
              <div className="w-0.5 h-4 bg-white rounded" />
            </div>

            {/* Trim Out handle */}
            <div
              className="absolute top-0 bottom-0 w-3 bg-accent cursor-ew-resize rounded-r flex items-center justify-center"
              style={{ left: outX - 6, zIndex: 3 }}
              onMouseDown={(e) => handleMouseDown(e, 'trimOut')}
            >
              <div className="w-0.5 h-4 bg-white rounded" />
            </div>
          </div>

          {/* Zoom keyframes track */}
          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT + TRACK_HEIGHT, height: ZOOM_TRACK_HEIGHT }}
          >
            <div className="absolute inset-y-2 left-0 right-0 bg-bg-tertiary/50 rounded" />
            {project.zoomKeyframes.map((kf) => {
              const kx = kf.time * PIXELS_PER_SECOND
              const kw = kf.duration * PIXELS_PER_SECOND
              const isSelected = selectedZoomId === kf.id
              return (
                <div
                  key={kf.id}
                  className={`absolute top-2 rounded text-[9px] font-medium px-1 flex items-center gap-0.5 cursor-pointer transition-colors
                    ${isSelected ? 'bg-accent text-white' : 'bg-accent/40 text-accent hover:bg-accent/60'}`}
                  style={{ left: kx, width: Math.max(kw, 20), bottom: 2 }}
                  onMouseDown={(e) => handleMouseDown(e, 'zoom', kf.id)}
                >
                  <ZoomIn size={10} />
                  <span className="truncate">{kf.scale.toFixed(1)}x</span>
                </div>
              )
            })}
          </div>

          {/* Annotation markers track */}
          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT + TRACK_HEIGHT + ZOOM_TRACK_HEIGHT, height: ANNOTATION_TRACK_HEIGHT }}
          >
            <div className="absolute inset-y-2 left-0 right-0 bg-bg-tertiary/30 rounded" />
            {project.annotations.map((ann) => {
              const ax = ann.time * PIXELS_PER_SECOND
              return (
                <div
                  key={ann.id}
                  className="absolute top-2 bottom-2 w-3 rounded-sm cursor-pointer"
                  style={{ left: ax, backgroundColor: ann.color }}
                  title={ann.type === 'text' ? ann.text : 'Arrow'}
                />
              )
            })}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 cursor-ew-resize"
            style={{ left: playheadX, zIndex: 10, transform: 'translateX(-1px)' }}
            onMouseDown={(e) => handleMouseDown(e, 'playhead')}
          >
            <div className="w-4 h-4 bg-white rounded-full -translate-x-1.5 mt-1 shadow-md" />
            <div className="w-0.5 bg-white h-full -translate-x-px" />
          </div>
        </div>
      </div>
    </div>
  )
}
