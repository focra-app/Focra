import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { PixiRenderer } from '../../lib/PixiRenderer'

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>
}

const FALLBACK_CANVAS_DIMENSION = 1

export default function VideoPreview({ videoRef }: VideoPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const rendererRef = useRef<PixiRenderer | null>(null)
  const bgImageRef = useRef<{ url: string; img: HTMLImageElement } | null>(null)
  const { project, currentTime, selectedTool, addAnnotation } = useEditorStore()

  // Track if we need to force a redraw because of state changes
  const forceRenderRef = useRef<() => void>(() => {})

  const renderFrame = useCallback(() => {
    const video = videoRef.current
    const renderer = rendererRef.current
    if (!renderer || !project) return

    const renderTime = video && !video.paused && !video.ended ? video.currentTime : currentTime

    // Background caching logic
    const bg = project.background
    if (bg.type === 'image' && bg.imageUrl) {
      if (bgImageRef.current?.url !== bg.imageUrl) {
        const img = new window.Image()
        img.onload = () => forceRenderRef.current()
        img.src = bg.imageUrl
        bgImageRef.current = { url: bg.imageUrl, img }
      }
    }

    const container = containerRef.current
    const width = container ? container.clientWidth : 800
    const height = container ? container.clientHeight : 450

    renderer.draw(
      project,
      renderTime,
      video!,
      bgImageRef.current?.img || null,
      width,
      height
    )

    if (video && !video.paused && !video.ended) {
      animFrameRef.current = requestAnimationFrame(forceRenderRef.current)
    } else {
      animFrameRef.current = 0
    }
  }, [project, currentTime, videoRef])

  useEffect(() => {
    forceRenderRef.current = renderFrame
    if (animFrameRef.current === 0) {
      forceRenderRef.current()
    }
  }, [renderFrame])

  // Initialize PixiRenderer
  useEffect(() => {
    if (!containerRef.current) return
    const renderer = new PixiRenderer()
    rendererRef.current = renderer
    let isMounted = true

    const init = async () => {
      await renderer.init(containerRef.current!, {
        width: containerRef.current!.clientWidth || 800,
        height: containerRef.current!.clientHeight || 450
      })
      if (!isMounted) return
      if (videoRef.current) {
        await renderer.loadVideo(videoRef.current)
      }
      if (!isMounted) return
      forceRenderRef.current()
    }
    init()

    return () => {
      isMounted = false
      renderer.destroy()
      rendererRef.current = null
    }
  }, []) // Empty deps so it runs once on mount

  // Watch for the video element becoming ready to load it into Pixi
  useEffect(() => {
    const video = videoRef.current
    if (!video || !rendererRef.current) return

    const handleLoadedMetadata = async () => {
      if (rendererRef.current) {
        await rendererRef.current.loadVideo(video)
        forceRenderRef.current()
      }
    }

    if (video.readyState >= 1) {
      handleLoadedMetadata()
    } else {
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [videoRef, project?.videoUrl]) // Re-run if videoUrl changes

  useLayoutEffect(() => {
    const video = videoRef.current
    const container = containerRef.current

    const syncCanvasMetrics = () => {
      if (!container) return false
      const rect = container.getBoundingClientRect()
      
      const baseCssWidth = Math.max(FALLBACK_CANVAS_DIMENSION, rect.width)
      const baseCssHeight = Math.max(FALLBACK_CANVAS_DIMENSION, rect.height)
      
      const pixelWidth = Math.floor(baseCssWidth)
      const pixelHeight = Math.floor(baseCssHeight)

      if (rendererRef.current && rendererRef.current.app) {
        if (rendererRef.current.app.canvas.width !== pixelWidth || rendererRef.current.app.canvas.height !== pixelHeight) {
          rendererRef.current.app.renderer.resize(pixelWidth, pixelHeight)
          return true
        }
      }
      return false
    }

    const startRenderLoop = () => {
      if (animFrameRef.current === 0) {
        animFrameRef.current = requestAnimationFrame(forceRenderRef.current)
      }
    }

    const renderSingleFrame = () => {
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = 0
      }
      forceRenderRef.current()
    }

    syncCanvasMetrics()
    renderSingleFrame()

    const hasResizeObserver = typeof ResizeObserver !== 'undefined'
    let resizeObserver: ResizeObserver | null = null
    
    if (hasResizeObserver && container) {
      resizeObserver = new ResizeObserver(() => {
        if (syncCanvasMetrics()) {
          renderSingleFrame()
        }
      })
      resizeObserver.observe(container)
    }

    const handleResize = () => {
      if (syncCanvasMetrics()) renderSingleFrame()
    }
    window.addEventListener('resize', handleResize)

    if (video) {
      video.addEventListener('play', startRenderLoop)
      video.addEventListener('pause', renderSingleFrame)
      video.addEventListener('ended', renderSingleFrame)
      video.addEventListener('seeked', renderSingleFrame)
      video.addEventListener('loadeddata', renderSingleFrame)
      video.addEventListener('canplay', renderSingleFrame)
      video.addEventListener('timeupdate', renderSingleFrame)
    }

    return () => {
      if (video) {
        video.removeEventListener('play', startRenderLoop)
        video.removeEventListener('pause', renderSingleFrame)
        video.removeEventListener('ended', renderSingleFrame)
        video.removeEventListener('seeked', renderSingleFrame)
        video.removeEventListener('loadeddata', renderSingleFrame)
        video.removeEventListener('canplay', renderSingleFrame)
        video.removeEventListener('timeupdate', renderSingleFrame)
      }
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = 0
      }
    }
  }, [videoRef])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!project) return
    const container = containerRef.current!
    const rect = container.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const id = `ann-${Date.now()}`
    addAnnotation({
      id,
      type: 'text',
      time: currentTime,
      duration: 3,
      x,
      y,
      text: 'Click to edit',
      fontSize: 24,
      color: '#ffffff'
    })
  }, [project, currentTime, addAnnotation])

  const isPlacementTool = selectedTool === 'text'

  return (
    <div className="relative w-full bg-black rounded-xl overflow-hidden border border-border">
      <div
        ref={containerRef}
        className="w-full aspect-video"
        onClick={isPlacementTool ? handleCanvasClick : undefined}
        style={{ cursor: isPlacementTool ? 'crosshair' : 'default' }}
      />
    </div>
  )
}
