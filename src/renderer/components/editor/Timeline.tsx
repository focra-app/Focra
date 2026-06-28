import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { ZoomIn, Scissors, Minus, Plus, MoveHorizontal } from 'lucide-react'

const BASE_PIXELS_PER_SECOND = 80
const MIN_TIMELINE_ZOOM = 0.4
const MAX_TIMELINE_ZOOM = 6
const EDGE_SCROLL_PADDING = 56
const EDGE_SCROLL_SPEED = 28
const RULER_HEIGHT = 24
const TRACK_HEIGHT = 48
const ZOOM_TRACK_HEIGHT = 32
const ANNOTATION_TRACK_HEIGHT = 28
const TRACK_BOTTOM_PADDING = 84

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface TimelineProps {
  videoRef: React.RefObject<HTMLVideoElement>
}

export default function Timeline({ videoRef }: TimelineProps) {
  const { project, currentTime, selectedZoomId, isPlaying, setCurrentTime, setTrimPoints, selectZoom, updateZoom, updateAnnotation } =
    useEditorStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingPlayhead = useRef(false)
  const isDraggingTrimIn = useRef(false)
  const isDraggingTrimOut = useRef(false)
  const isDraggingZoom = useRef<string | null>(null)
  const isDraggingZoomResizeLeft = useRef<string | null>(null)
  const isDraggingZoomResizeRight = useRef<string | null>(null)
  const isDraggingAnnotation = useRef<string | null>(null)

  const dragStartX = useRef(0)
  const dragStartTime = useRef(0)
  const dragStartDuration = useRef(0)
  
  const [timelineZoom, setTimelineZoom] = useState(1)

  if (!project) return null

  const duration = project.duration
  const pixelsPerSecond = useMemo(
    () => BASE_PIXELS_PER_SECOND * timelineZoom,
    [timelineZoom]
  )
  const totalWidth = Math.max(duration * pixelsPerSecond, 720)
  const contentHeight = RULER_HEIGHT + TRACK_HEIGHT + ZOOM_TRACK_HEIGHT + ANNOTATION_TRACK_HEIGHT + TRACK_BOTTOM_PADDING
  const { inPoint, outPoint } = project.trimPoints

  const clampTimelineZoom = useCallback((nextZoom: number) => {
    return Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, nextZoom))
  }, [])

  const nudgeScrollDuringDrag = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()

    if (clientX < rect.left + EDGE_SCROLL_PADDING) {
      const distance = rect.left + EDGE_SCROLL_PADDING - clientX
      container.scrollLeft -= EDGE_SCROLL_SPEED + distance * 0.25
    } else if (clientX > rect.right - EDGE_SCROLL_PADDING) {
      const distance = clientX - (rect.right - EDGE_SCROLL_PADDING)
      container.scrollLeft += EDGE_SCROLL_SPEED + distance * 0.25
    }

    if (clientY < rect.top + EDGE_SCROLL_PADDING) {
      const distance = rect.top + EDGE_SCROLL_PADDING - clientY
      container.scrollTop -= EDGE_SCROLL_SPEED + distance * 0.25
    } else if (clientY > rect.bottom - EDGE_SCROLL_PADDING) {
      const distance = clientY - (rect.bottom - EDGE_SCROLL_PADDING)
      container.scrollTop += EDGE_SCROLL_SPEED + distance * 0.25
    }
  }, [])

  const keepPointVisible = useCallback((x: number, padding = 120) => {
    const container = containerRef.current
    if (!container) return
    const viewportLeft = container.scrollLeft
    const viewportRight = viewportLeft + container.clientWidth

    if (x < viewportLeft + padding) {
      container.scrollLeft = Math.max(0, x - padding)
      return
    }

    if (x > viewportRight - padding) {
      container.scrollLeft = Math.max(0, x - container.clientWidth + padding)
    }
  }, [])

  const timeFromX = (clientX: number) => {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    const scrollLeft = container.scrollLeft
    const x = clientX - rect.left + scrollLeft
    return Math.max(0, Math.min(duration, x / pixelsPerSecond))
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
    } else if (type === 'zoom-resize-left' && id) {
      isDraggingZoomResizeLeft.current = id
      const kf = project.zoomKeyframes.find((k) => k.id === id)
      dragStartTime.current = kf?.time ?? 0
      dragStartDuration.current = kf?.duration ?? 0
      selectZoom(id)
    } else if (type === 'zoom-resize-right' && id) {
      isDraggingZoomResizeRight.current = id
      const kf = project.zoomKeyframes.find((k) => k.id === id)
      dragStartTime.current = kf?.time ?? 0
      dragStartDuration.current = kf?.duration ?? 0
      selectZoom(id)
    } else if (type === 'annotation' && id) {
      isDraggingAnnotation.current = id
      const ann = project.annotations.find((a) => a.id === id)
      dragStartTime.current = ann?.time ?? 0
    }
  }, [currentTime, inPoint, outPoint, project, selectZoom])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (
        isDraggingPlayhead.current
        || isDraggingTrimIn.current
        || isDraggingTrimOut.current
        || isDraggingZoom.current
        || isDraggingZoomResizeLeft.current
        || isDraggingZoomResizeRight.current
        || isDraggingAnnotation.current
      ) {
        nudgeScrollDuringDrag(e.clientX, e.clientY)
      }

      const t = timeFromX(e.clientX)
      const dx = e.clientX - dragStartX.current
      const dt = dx / pixelsPerSecond

      if (isDraggingPlayhead.current) {
        setCurrentTime(t)
        if (videoRef.current) videoRef.current.currentTime = t
        keepPointVisible(t * pixelsPerSecond)
      } else if (isDraggingTrimIn.current) {
        setTrimPoints({ inPoint: Math.min(t, outPoint - 0.5), outPoint })
      } else if (isDraggingTrimOut.current) {
        setTrimPoints({ inPoint, outPoint: Math.max(t, inPoint + 0.5) })
      } else if (isDraggingZoom.current) {
        const id = isDraggingZoom.current
        const newTime = Math.max(0, Math.min(duration, dragStartTime.current + dt))
        updateZoom(id, { time: newTime })
      } else if (isDraggingZoomResizeLeft.current) {
        const id = isDraggingZoomResizeLeft.current
        const maxTime = dragStartTime.current + dragStartDuration.current - 0.2
        const newTime = Math.min(maxTime, Math.max(0, dragStartTime.current + dt))
        const newDuration = (dragStartTime.current + dragStartDuration.current) - newTime
        updateZoom(id, { time: newTime, duration: newDuration })
      } else if (isDraggingZoomResizeRight.current) {
        const id = isDraggingZoomResizeRight.current
        const newDuration = Math.max(0.2, dragStartDuration.current + dt)
        updateZoom(id, { duration: newDuration })
      } else if (isDraggingAnnotation.current) {
        const id = isDraggingAnnotation.current
        const newTime = Math.max(0, Math.min(duration, dragStartTime.current + dt))
        updateAnnotation(id, { time: newTime })
      }
    }
    const onMouseUp = () => {
      isDraggingPlayhead.current = false
      isDraggingTrimIn.current = false
      isDraggingTrimOut.current = false
      isDraggingZoom.current = null
      isDraggingZoomResizeLeft.current = null
      isDraggingZoomResizeRight.current = null
      isDraggingAnnotation.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [
    duration,
    inPoint,
    keepPointVisible,
    nudgeScrollDuringDrag,
    outPoint,
    pixelsPerSecond,
    setCurrentTime,
    setTrimPoints,
    updateZoom,
    updateAnnotation,
    videoRef
  ])

  useEffect(() => {
    if (!isPlaying && !isDraggingPlayhead.current) return
    keepPointVisible(currentTime * pixelsPerSecond)
  }, [currentTime, isPlaying, keepPointVisible, pixelsPerSecond])

  const ticks: number[] = []
  const majorStep = duration > 60 ? 10 : duration > 30 ? 5 : 2
  for (let t = 0; t <= duration; t += majorStep) ticks.push(t)

  const playheadX = currentTime * pixelsPerSecond
  const inX = inPoint * pixelsPerSecond
  const outX = outPoint * pixelsPerSecond
  const zoomPercent = Math.round(timelineZoom * 100)

  return (
    <div className="flex flex-col bg-bg-secondary border-t border-border select-none" style={{ height: 224 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
        <Scissors size={13} className="text-text-secondary" />
        <span className="text-xs text-text-secondary font-medium">Timeline</span>
        <span className="text-xs text-text-muted ml-2">{formatTime(currentTime)}</span>
        <div className="ml-auto flex items-center gap-1.5 no-drag">
          <button
            onClick={() => setTimelineZoom((prev) => clampTimelineZoom(prev - 0.2))}
            className="w-6 h-6 rounded-md border border-border text-text-secondary hover:text-text-primary hover:border-[#4a4a4a] flex items-center justify-center"
            title="Zoom out timeline"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => setTimelineZoom((prev) => clampTimelineZoom(prev + 0.2))}
            className="w-6 h-6 rounded-md border border-border text-text-secondary hover:text-text-primary hover:border-[#4a4a4a] flex items-center justify-center"
            title="Zoom in timeline"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => {
              const container = containerRef.current
              if (!container || duration <= 0) return
              const targetZoom = clampTimelineZoom((container.clientWidth - 120) / (duration * BASE_PIXELS_PER_SECOND))
              setTimelineZoom(targetZoom)
            }}
            className="h-6 px-2 rounded-md border border-border text-[10px] text-text-secondary hover:text-text-primary hover:border-[#4a4a4a] flex items-center gap-1"
            title="Fit timeline to viewport width"
          >
            <MoveHorizontal size={11} />
            Fit
          </button>
          <span className="text-[10px] text-text-muted w-10 text-right">{zoomPercent}%</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const delta = e.deltaY > 0 ? -0.2 : 0.2
            setTimelineZoom((prev) => clampTimelineZoom(prev + delta))
            return
          }
          if (!e.shiftKey || !containerRef.current) return
          e.preventDefault()
          containerRef.current.scrollLeft += e.deltaY
        }}
      >
        <div style={{ width: totalWidth + 80, height: contentHeight, position: 'relative' }}>
          {/* Ruler Background */}
          <div
            className="absolute top-0 left-0 right-0 bg-bg-tertiary border-b border-border cursor-text hover:bg-[#202020]"
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
                  style={{ left: t * pixelsPerSecond }}
                >
                <div className="w-px h-3 bg-border mt-1" />
                <span className="text-[10px] text-text-muted mt-0.5">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          <div
            className="absolute bg-bg-primary/60 pointer-events-none"
            style={{ top: RULER_HEIGHT, left: 0, width: inX, bottom: 0, zIndex: 1 }}
          />
          <div
            className="absolute bg-bg-primary/60 pointer-events-none"
            style={{ top: RULER_HEIGHT, left: outX, right: 0, bottom: 0, zIndex: 1 }}
          />

          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT, height: TRACK_HEIGHT }}
          >
            <div
              className="absolute bg-accent/30 border border-accent/50 rounded overflow-hidden"
              style={{ left: 0, width: totalWidth, top: 6, height: TRACK_HEIGHT - 12, minWidth: 32 }}
            >
              <div className="h-full flex items-center px-2">
                <span className="text-[10px] text-accent truncate">Video Clip</span>
              </div>
            </div>
            <div
              className="absolute top-0 bottom-0 w-3 bg-accent cursor-ew-resize rounded-l flex items-center justify-center hover:bg-accent-hover transition-colors"
              style={{ left: inX - 6, zIndex: 3 }}
              onMouseDown={(e) => handleMouseDown(e, 'trimIn')}
            >
              <div className="w-0.5 h-4 bg-white rounded" />
            </div>
            <div
              className="absolute top-0 bottom-0 w-3 bg-accent cursor-ew-resize rounded-r flex items-center justify-center hover:bg-accent-hover transition-colors"
              style={{ left: outX - 6, zIndex: 3 }}
              onMouseDown={(e) => handleMouseDown(e, 'trimOut')}
            >
              <div className="w-0.5 h-4 bg-white rounded" />
            </div>
          </div>

          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT + TRACK_HEIGHT, height: ZOOM_TRACK_HEIGHT }}
          >
            <div className="absolute inset-y-2 left-0 right-0 bg-bg-tertiary/50 rounded" />
            {project.zoomKeyframes.map((kf) => {
              const kx = kf.time * pixelsPerSecond
              const kw = kf.duration * pixelsPerSecond
              const isSelected = selectedZoomId === kf.id
              return (
                <div
                  key={kf.id}
                  className={`absolute top-2 rounded text-[9px] font-medium flex items-center gap-0.5 cursor-grab active:cursor-grabbing transition-colors group
                    ${isSelected ? 'bg-accent text-white border border-accent/50' : 'bg-accent/40 text-accent hover:bg-accent/60 border border-transparent'}`}
                  style={{ left: kx, width: Math.max(kw, 20), bottom: 2 }}
                  onMouseDown={(e) => handleMouseDown(e, 'zoom', kf.id)}
                >
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 transition-colors rounded-l" 
                    onMouseDown={(e) => handleMouseDown(e, 'zoom-resize-left', kf.id)} 
                  />
                  
                  <div className="flex-1 flex items-center gap-1 px-1 overflow-hidden pointer-events-none">
                    <ZoomIn size={10} className="flex-shrink-0" />
                    <span className="truncate">{kf.scale.toFixed(1)}x</span>
                  </div>
                  
                  <div 
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 transition-colors rounded-r" 
                    onMouseDown={(e) => handleMouseDown(e, 'zoom-resize-right', kf.id)} 
                  />
                </div>
              )
            })}
          </div>

          <div
            className="absolute left-0 right-0"
            style={{ top: RULER_HEIGHT + TRACK_HEIGHT + ZOOM_TRACK_HEIGHT, height: ANNOTATION_TRACK_HEIGHT }}
          >
            <div className="absolute inset-y-2 left-0 right-0 bg-bg-tertiary/30 rounded" />
            {project.annotations.map((ann) => {
              const ax = ann.time * pixelsPerSecond
              return (
                <div
                  key={ann.id}
                  className="absolute top-2 bottom-2 w-3 rounded-sm cursor-grab active:cursor-grabbing hover:brightness-125 transition-all"
                  style={{ left: ax, backgroundColor: ann.color, transform: 'translateX(-50%)' }}
                  title={ann.type === 'text' ? ann.text : 'Arrow'}
                  onMouseDown={(e) => handleMouseDown(e, 'annotation', ann.id)}
                />
              )
            })}
          </div>

          <div
            className="absolute top-0 bottom-0 cursor-ew-resize hover:bg-white/10 group transition-colors"
            style={{ left: playheadX, zIndex: 10, transform: 'translateX(-1px)' }}
            onMouseDown={(e) => handleMouseDown(e, 'playhead')}
          >
            <div className="w-4 h-4 bg-white rounded-full -translate-x-1.5 mt-1 shadow-md scale-100 group-hover:scale-110 transition-transform" />
            <div className="w-0.5 bg-white h-full -translate-x-px group-hover:bg-accent-hover transition-colors shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
          </div>
        </div>
      </div>
    </div>
  )
}
