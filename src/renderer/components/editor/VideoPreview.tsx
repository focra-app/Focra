import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import type { ZoomKeyframe } from '../../types'

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>
}

function cubicEase(t: number, easing: ZoomKeyframe['easing']): number {
  switch (easing) {
    case 'ease-in': return t * t * t
    case 'ease-out': return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    default: return t
  }
}

function getZoomTransform(keyframes: ZoomKeyframe[], time: number) {
  // Check if we're inside any keyframe
  for (const kf of keyframes) {
    const inTime = kf.time
    const outTime = kf.time + kf.duration
    const halfDur = kf.duration * 0.25 // transition portion

    if (time >= inTime && time <= outTime) {
      let scale = 1
      let progress = 0

      if (time < inTime + halfDur) {
        // Zoom in
        progress = (time - inTime) / halfDur
        scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
      } else if (time > outTime - halfDur) {
        // Zoom out
        progress = (outTime - time) / halfDur
        scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
      } else {
        // Hold
        scale = kf.scale
      }

      const tx = (0.5 - kf.x) * (scale - 1)
      const ty = (0.5 - kf.y) * (scale - 1)

      return { scale, tx, ty, motionBlur: kf.motionBlur && scale > 1.05 }
    }
  }
  return { scale: 1, tx: 0, ty: 0, motionBlur: false }
}

export default function VideoPreview({ videoRef }: VideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const { project, currentTime, selectedTool, addAnnotation } = useEditorStore()

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !project) return

    const W = canvas.width
    const H = canvas.height

    // Draw background
    const bg = project.background
    if (bg.type === 'solid') {
      ctx.fillStyle = bg.color || '#0f0f0f'
      ctx.fillRect(0, 0, W, H)
    } else if (bg.type === 'gradient' && bg.gradient) {
      const { type, stops, angle = 0 } = bg.gradient
      let grad: CanvasGradient
      if (type === 'linear') {
        const rad = (angle * Math.PI) / 180
        const x1 = W / 2 - (Math.cos(rad) * W) / 2
        const y1 = H / 2 - (Math.sin(rad) * H) / 2
        const x2 = W / 2 + (Math.cos(rad) * W) / 2
        const y2 = H / 2 + (Math.sin(rad) * H) / 2
        grad = ctx.createLinearGradient(x1, y1, x2, y2)
      } else {
        grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) / 2)
      }
      stops.forEach((s) => grad.addColorStop(s.position, s.color))
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    } else {
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, W, H)
    }

    if (video && video.readyState >= 2) {
      const zoom = getZoomTransform(project.zoomKeyframes, currentTime)
      const { scale, tx, ty, motionBlur } = zoom

      // Apply crop or use full video
      const crop = project.cropSettings
      const srcX = crop ? crop.x * video.videoWidth : 0
      const srcY = crop ? crop.y * video.videoHeight : 0
      const srcW = crop ? crop.width * video.videoWidth : video.videoWidth
      const srcH = crop ? crop.height * video.videoHeight : video.videoHeight

      // Fit video in canvas with padding
      const padding = 40
      const availW = W - padding * 2
      const availH = H - padding * 2
      const ratio = srcW / srcH
      let dw = availW
      let dh = availW / ratio
      if (dh > availH) {
        dh = availH
        dw = availH * ratio
      }
      const dx = (W - dw) / 2
      const dy = (H - dh) / 2

      ctx.save()
      if (motionBlur) {
        ctx.filter = `blur(${Math.round((scale - 1) * 3)}px)`
      }
      ctx.translate(W / 2 + tx * dw, H / 2 + ty * dh)
      ctx.scale(scale, scale)
      ctx.translate(-W / 2, -H / 2)
      ctx.drawImage(video, srcX, srcY, srcW, srcH, dx, dy, dw, dh)
      ctx.restore()

      // Draw annotations
      const visibleAnnotations = project.annotations.filter(
        (a) => currentTime >= a.time && currentTime <= a.time + a.duration
      )
      for (const ann of visibleAnnotations) {
        const ax = ann.x * W
        const ay = ann.y * H
        ctx.save()
        if (ann.type === 'text') {
          ctx.font = `bold ${ann.fontSize || 24}px -apple-system, sans-serif`
          ctx.fillStyle = ann.color
          ctx.shadowColor = 'rgba(0,0,0,0.5)'
          ctx.shadowBlur = 4
          ctx.fillText(ann.text || '', ax, ay)
        } else if (ann.type === 'arrow' && ann.endX !== undefined && ann.endY !== undefined) {
          const ex = ann.endX * W
          const ey = ann.endY * H
          const sw = ann.strokeWidth || 3
          ctx.strokeStyle = ann.color
          ctx.lineWidth = sw
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(ex, ey)
          ctx.stroke()
          // Arrowhead
          const angle = Math.atan2(ey - ay, ex - ax)
          const arrowLen = 16
          ctx.beginPath()
          ctx.moveTo(ex, ey)
          ctx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4))
          ctx.moveTo(ex, ey)
          ctx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4))
          ctx.stroke()
        }
        ctx.restore()
      }
    }

    if (video && !video.paused && !video.ended) {
      animFrameRef.current = requestAnimationFrame(renderFrame)
    } else {
      animFrameRef.current = 0
    }
  }, [project, currentTime, videoRef])

  useEffect(() => {
    const video = videoRef.current

    const startRenderLoop = () => {
      if (animFrameRef.current === 0) {
        animFrameRef.current = requestAnimationFrame(renderFrame)
      }
    }

    const renderSingleFrame = () => {
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = 0
      }
      renderFrame()
    }

    // Render one frame immediately for initial state / when currentTime changes
    renderSingleFrame()

    if (video) {
      video.addEventListener('play', startRenderLoop)
      video.addEventListener('pause', renderSingleFrame)
      video.addEventListener('ended', renderSingleFrame)
      video.addEventListener('seeked', renderSingleFrame)
    }

    return () => {
      if (video) {
        video.removeEventListener('play', startRenderLoop)
        video.removeEventListener('pause', renderSingleFrame)
        video.removeEventListener('ended', renderSingleFrame)
        video.removeEventListener('seeked', renderSingleFrame)
      }
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = 0
      }
    }
  }, [renderFrame, videoRef])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!project) return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
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

  // Only the text tool uses canvas click placement; arrow/crop tools are not yet supported
  const isPlacementTool = selectedTool === 'text'

  return (
    <div className="relative w-full bg-black rounded-xl overflow-hidden border border-border">
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="w-full aspect-video"
        onClick={isPlacementTool ? handleCanvasClick : undefined}
        style={{ cursor: isPlacementTool ? 'crosshair' : 'default' }}
      />
    </div>
  )
}
