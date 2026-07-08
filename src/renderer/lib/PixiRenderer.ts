import { Application, Container, Sprite, Texture, Graphics, Rectangle, VideoSource } from 'pixi.js'
import { MotionBlurFilter } from 'pixi-filters'
import type { EditorProject } from '../types'
import { getZoomTransformAtTime, type ZoomTransform } from '../components/editor/zoomTransform'
import { getSmoothedCursorPath } from './cursor/cursorPathSmoothing'

export interface PixiRendererConfig {
  width: number
  height: number
}

const RENDER_PADDING_PX = 16
const MAX_MOTION_BLUR_PX = 1.5
const MOTION_BLUR_SCALE_FACTOR = 1.2
const MIN_VISIBLE_MOTION_BLUR_PX = 0.5

export class PixiRenderer {
  public app: Application
  private videoSprite: Sprite | null = null
  private bgGraphics: Graphics | null = null
  private videoContainer: Container
  private annotationContainer: Container
  private annotationSprite: Sprite | null = null
  private annotationCanvas: HTMLCanvasElement
  private annotationCtx: CanvasRenderingContext2D
  private cursorGraphics: Graphics | null = null
  private motionBlurFilter: MotionBlurFilter | null = null

  private isDestroyed: boolean = false
  private offscreenCanvas: OffscreenCanvas | null = null
  private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null

  constructor() {
    this.app = new Application()
    this.videoContainer = new Container()
    this.annotationContainer = new Container()
    
    this.annotationCanvas = document.createElement('canvas')
    this.annotationCtx = this.annotationCanvas.getContext('2d')!
  }

  public getCanvas(): HTMLCanvasElement {
    return this.app.canvas
  }

  public async init(container: HTMLDivElement, config: PixiRendererConfig) {
    await this.app.init({
      preference: 'webgl',
      width: config.width,
      height: config.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: 1, // We control the canvas size directly
      autoDensity: true
    })

    if (this.isDestroyed) {
      this.destroy()
      return
    }

    container.appendChild(this.app.canvas)
    this.app.canvas.style.width = '100%'
    this.app.canvas.style.height = '100%'

    this.bgGraphics = new Graphics()
    this.app.stage.addChild(this.bgGraphics)

    this.app.stage.addChild(this.videoContainer)
    this.app.stage.addChild(this.annotationContainer)

    this.cursorGraphics = new Graphics()
    this.cursorGraphics.poly([
      0, 0,
      18, 18,
      9, 18,
      14, 28,
      10, 30,
      5, 20,
      0, 24
    ])
    this.cursorGraphics.fill({ color: 0x000000 })
    this.cursorGraphics.stroke({ color: 0xffffff, width: 2, alignment: 1 })
    this.cursorGraphics.visible = false
    this.videoContainer.addChild(this.cursorGraphics)
  }

  public async loadVideo(videoEl: HTMLVideoElement) {
    try {
      const source = VideoSource.from(videoEl)
      if ('autoPlay' in source) {
        (source as any).autoPlay = false
      }
      if ('autoUpdate' in source) {
        (source as any).autoUpdate = true
      }
      
      // If we already have a sprite and it uses the exact same source, just return
      if (this.videoSprite && this.videoSprite.texture && this.videoSprite.texture.source === source) {
        return;
      }
      
      const texture = Texture.from(source)
      if (this.videoSprite) {
        if (this.videoSprite.texture) {
          // Pass false so we don't destroy the underlying source if it might be reused elsewhere
          this.videoSprite.texture.destroy(false)
        }
        this.videoContainer.removeChild(this.videoSprite)
        this.videoSprite.destroy()
      }
      this.videoSprite = new Sprite(texture)
      this.videoContainer.addChild(this.videoSprite)
    } catch (e) {
      console.error('Focra: Failed to load video into Pixi', e)
    }
  }

  public draw(
    project: EditorProject,
    renderTime: number,
    videoEl: HTMLVideoElement,
    _bgImage: HTMLImageElement | null,
    width: number,
    height: number,
    precomputed?: {
      zoomTransform?: ZoomTransform
      visibleAnnotations?: EditorProject['annotations']
    }
  ) {
    if (!this.app || !this.bgGraphics) return

    // 1. Draw Background
    this.bgGraphics.clear()
    const bg = project.background
    if (bg.type === 'solid' && bg.color) {
      this.bgGraphics.rect(0, 0, width, height)
      this.bgGraphics.fill(bg.color)
    } else {
      this.bgGraphics.rect(0, 0, width, height)
      this.bgGraphics.fill('#1a1a1a')
    }

    if (videoEl.readyState >= 2 && this.videoSprite) {
      this.videoSprite.texture.source.update()

      const { scale, tx, ty, motionBlur } = precomputed?.zoomTransform ?? getZoomTransformAtTime(project.zoomKeyframes, renderTime)

      const crop = project.cropSettings
      const srcX = crop ? crop.x * videoEl.videoWidth : 0
      const srcY = crop ? crop.y * videoEl.videoHeight : 0
      const srcW = crop ? crop.width * videoEl.videoWidth : videoEl.videoWidth
      const srcH = crop ? crop.height * videoEl.videoHeight : videoEl.videoHeight

      const padding = RENDER_PADDING_PX
      const availW = Math.max(1, width - padding * 2)
      const availH = Math.max(1, height - padding * 2)
      const ratio = srcW / srcH
      let dw = availW
      let dh = availW / ratio
      if (dh > availH) {
        dh = availH
        dw = availH * ratio
      }
      
      if (srcW > 0 && srcH > 0) {
        if (this.videoSprite.texture.frame.x !== srcX || this.videoSprite.texture.frame.y !== srcY || this.videoSprite.texture.frame.width !== srcW || this.videoSprite.texture.frame.height !== srcH) {
          this.videoSprite.texture = new Texture({ source: this.videoSprite.texture.source, frame: new Rectangle(srcX, srcY, srcW, srcH) })
        }
      }
      
      if (dw > 0 && dh > 0) {
        this.videoSprite.width = dw
        this.videoSprite.height = dh
        this.videoSprite.position.set(-dw / 2, -dh / 2)
      }

      this.videoContainer.position.set(width / 2 + tx * dw, height / 2 + ty * dh)
      this.videoContainer.scale.set(scale, scale)

      if (motionBlur) {
        const blurPixels = Math.min(
          MAX_MOTION_BLUR_PX,
          Math.max(0, (scale - 1) * MOTION_BLUR_SCALE_FACTOR)
        )
        if (blurPixels >= MIN_VISIBLE_MOTION_BLUR_PX) {
          if (!this.motionBlurFilter) {
            this.motionBlurFilter = new MotionBlurFilter({ velocity: [tx * blurPixels * 10, ty * blurPixels * 10] })
          } else {
            this.motionBlurFilter.velocity = [tx * blurPixels * 10, ty * blurPixels * 10]
          }
          this.videoContainer.filters = [this.motionBlurFilter]
        } else {
          this.videoContainer.filters = []
        }
      } else {
        this.videoContainer.filters = []
      }
      this.videoContainer.visible = true
    } else if (this.videoSprite) {
      this.videoContainer.visible = false
    }



    // 3. Draw Annotations
    const visibleAnnotations = precomputed?.visibleAnnotations ?? project.annotations.filter(
      (a: any) => renderTime >= a.time && renderTime <= a.time + a.duration
    )

    if (visibleAnnotations.length > 0) {
      if (this.annotationCanvas.width !== width || this.annotationCanvas.height !== height) {
        this.annotationCanvas.width = width
        this.annotationCanvas.height = height
      }
      this.annotationCtx.clearRect(0, 0, width, height)
      
      for (const annotation of visibleAnnotations) {
        const ax = annotation.x * width
        const ay = annotation.y * height
        this.annotationCtx.save()

        if (annotation.type === 'text') {
          const isCaption = annotation.annotationSource === 'auto-caption'
          this.annotationCtx.font = `bold ${annotation.fontSize || 24}px -apple-system, sans-serif`
          this.annotationCtx.fillStyle = annotation.color
          this.annotationCtx.textAlign = isCaption ? 'center' : 'start'
          this.annotationCtx.textBaseline = isCaption ? 'middle' : 'alphabetic'
          
          if (isCaption) {
            this.annotationCtx.lineWidth = Math.max(2, (annotation.fontSize || 24) * 0.15)
            this.annotationCtx.strokeStyle = 'rgba(0,0,0,0.8)'
            this.annotationCtx.strokeText(annotation.text || '', ax, ay)
            this.annotationCtx.shadowBlur = 0
          } else {
            this.annotationCtx.shadowColor = 'rgba(0,0,0,0.5)'
            this.annotationCtx.shadowBlur = 4
          }
          this.annotationCtx.fillText(annotation.text || '', ax, ay)
          this.annotationCtx.shadowBlur = 0
        } else if (annotation.type === 'arrow' && annotation.endX !== undefined && annotation.endY !== undefined) {
          const ex = annotation.endX * width
          const ey = annotation.endY * height
          const sw = annotation.strokeWidth || 3
          this.annotationCtx.strokeStyle = annotation.color
          this.annotationCtx.lineWidth = sw
          this.annotationCtx.lineCap = 'round'
          this.annotationCtx.beginPath()
          this.annotationCtx.moveTo(ax, ay)
          this.annotationCtx.lineTo(ex, ey)
          this.annotationCtx.stroke()

          const angle = Math.atan2(ey - ay, ex - ax)
          const arrowLen = 16
          this.annotationCtx.beginPath()
          this.annotationCtx.moveTo(ex, ey)
          this.annotationCtx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4))
          this.annotationCtx.moveTo(ex, ey)
          this.annotationCtx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4))
          this.annotationCtx.stroke()
        }
        this.annotationCtx.restore()
      }

      if (this.annotationSprite) {
        this.annotationSprite.texture.source.update()
      } else {
        const tex = Texture.from(this.annotationCanvas)
        this.annotationSprite = new Sprite(tex)
        this.annotationContainer.addChild(this.annotationSprite)
      }
      this.annotationSprite.visible = true
    } else if (this.annotationSprite) {
      this.annotationSprite.visible = false
    }

    if (this.cursorGraphics && project.cursorEvents && project.cursorEvents.length > 0 && videoEl.readyState >= 2) {
      const smoothingFactor = project.cursorSmoothing ?? 0.5
      const smoothedPath = getSmoothedCursorPath(project.cursorEvents, smoothingFactor)
      const timeMs = renderTime * 1000
      const pos = smoothedPath?.sampleAt(timeMs)
      if (pos) {
        const captureW = project.captureWidth || videoEl.videoWidth
        const captureH = project.captureHeight || videoEl.videoHeight
        
        // Map native capture coordinates to the video dimensions
        const uncroppedX = (pos.x / captureW) * videoEl.videoWidth
        const uncroppedY = (pos.y / captureH) * videoEl.videoHeight
        
        // Get the current crop bounds from earlier in the method
        const crop = project.cropSettings
        const srcX = crop ? crop.x * videoEl.videoWidth : 0
        const srcY = crop ? crop.y * videoEl.videoHeight : 0
        const srcW = crop ? crop.width * videoEl.videoWidth : videoEl.videoWidth
        const srcH = crop ? crop.height * videoEl.videoHeight : videoEl.videoHeight
        
        // Calculate the relative position inside the cropped area
        const relX = uncroppedX - srcX
        const relY = uncroppedY - srcY
        
        // Normalize against the cropped area bounds
        const normX = relX / srcW
        const normY = relY / srcH
        
        // Map to videoContainer's internal coordinate system which uses dw/dh and is centered
        // We calculate dw and dh the same way they were calculated above
        const padding = 16 // RENDER_PADDING_PX
        const availW = Math.max(1, width - padding * 2)
        const availH = Math.max(1, height - padding * 2)
        const ratio = srcW / srcH
        let dw = availW
        let dh = availW / ratio
        if (dh > availH) {
          dh = availH
          dw = availH * ratio
        }
        
        const localX = (normX - 0.5) * dw
        const localY = (normY - 0.5) * dh
        
        // Check if it's within the crop bounds visually
        if (normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1) {
          this.cursorGraphics.visible = true
          this.cursorGraphics.position.set(localX, localY)
          
          // Maintain a constant visual size for the cursor by un-scaling it relative to videoContainer's scale
          const { scale } = precomputed?.zoomTransform ?? getZoomTransformAtTime(project.zoomKeyframes, renderTime)
          const baseCursorScale = 1.5
          this.cursorGraphics.scale.set(baseCursorScale / scale)
        } else {
          this.cursorGraphics.visible = false
        }
      } else {
        this.cursorGraphics.visible = false
      }
    } else if (this.cursorGraphics) {
      this.cursorGraphics.visible = false
    }

    // Force a render
    this.app.render()
  }

  public destroy() {
    this.isDestroyed = true
    if (!this.app || !(this.app as any).renderer) {
      // App hasn't finished init(). It will destroy itself when init() resolves.
      return
    }

    // Pixi v8 bug: _cancelResize might be undefined if resizeTo wasn't used
    if (typeof (this.app as any)._cancelResize !== 'function') {
      (this.app as any)._cancelResize = () => {}
    }
    
    // Explicitly destroy our textures to prevent memory leaks
    if (this.app) {
      if (this.app.canvas && this.app.canvas.parentNode) {
        this.app.canvas.parentNode.removeChild(this.app.canvas)
      }
      this.app.destroy(true, {
        children: true,
        texture: true,
        textureSource: true
      })
    }
    this.videoSprite = null
  }

  public drawFrame(
    project: EditorProject,
    renderTime: number,
    frame: VideoFrame,
    _bgImage: HTMLImageElement | null,
    width: number,
    height: number,
    precomputed?: {
      zoomTransform?: ZoomTransform
      visibleAnnotations?: EditorProject['annotations']
    }
  ) {
    if (!this.app || !this.bgGraphics) return

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
      this.offscreenCtx = this.offscreenCanvas.getContext('2d')!
      
      const texture = Texture.from(this.offscreenCanvas as any)
      if (this.videoSprite) {
        if (this.videoSprite.texture) {
          this.videoSprite.texture.destroy(false)
        }
        this.videoContainer.removeChild(this.videoSprite)
        this.videoSprite.destroy()
      }
      this.videoSprite = new Sprite(texture)
      this.videoContainer.addChild(this.videoSprite)
    }

    if (this.offscreenCanvas.width !== frame.displayWidth || this.offscreenCanvas.height !== frame.displayHeight) {
      this.offscreenCanvas.width = frame.displayWidth
      this.offscreenCanvas.height = frame.displayHeight
    }

    this.offscreenCtx!.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
    this.offscreenCtx!.drawImage(frame, 0, 0)
    
    this.videoSprite!.texture.source.update()

    this.bgGraphics.clear()
    const bg = project.background
    if (bg.type === 'solid' && bg.color) {
      this.bgGraphics.rect(0, 0, width, height)
      this.bgGraphics.fill(bg.color)
    } else {
      this.bgGraphics.rect(0, 0, width, height)
      this.bgGraphics.fill('#1a1a1a')
    }

    if (this.videoSprite) {
      const { scale, tx, ty, motionBlur } = precomputed?.zoomTransform ?? getZoomTransformAtTime(project.zoomKeyframes, renderTime)

      const crop = project.cropSettings
      const srcX = crop ? crop.x * frame.displayWidth : 0
      const srcY = crop ? crop.y * frame.displayHeight : 0
      const srcW = crop ? crop.width * frame.displayWidth : frame.displayWidth
      const srcH = crop ? crop.height * frame.displayHeight : frame.displayHeight

      const padding = RENDER_PADDING_PX
      const availW = Math.max(1, width - padding * 2)
      const availH = Math.max(1, height - padding * 2)
      const ratio = srcW / srcH
      let dw = availW
      let dh = availW / ratio
      if (dh > availH) {
        dh = availH
        dw = availH * ratio
      }
      
      if (srcW > 0 && srcH > 0) {
        if (this.videoSprite.texture.frame.x !== srcX || this.videoSprite.texture.frame.y !== srcY || this.videoSprite.texture.frame.width !== srcW || this.videoSprite.texture.frame.height !== srcH) {
          this.videoSprite.texture = new Texture({ source: this.videoSprite.texture.source, frame: new Rectangle(srcX, srcY, srcW, srcH) })
        }
      }
      
      if (dw > 0 && dh > 0) {
        this.videoSprite.width = dw
        this.videoSprite.height = dh
        this.videoSprite.position.set(-dw / 2, -dh / 2)
      }

      this.videoContainer.position.set(width / 2 + tx * dw, height / 2 + ty * dh)
      this.videoContainer.scale.set(scale, scale)

      if (motionBlur) {
        const blurPixels = Math.min(
          MAX_MOTION_BLUR_PX,
          Math.max(0, (scale - 1) * MOTION_BLUR_SCALE_FACTOR)
        )
        if (blurPixels >= MIN_VISIBLE_MOTION_BLUR_PX) {
          if (!this.motionBlurFilter) {
            this.motionBlurFilter = new MotionBlurFilter({ velocity: [tx * blurPixels * 10, ty * blurPixels * 10] })
          } else {
            this.motionBlurFilter.velocity = [tx * blurPixels * 10, ty * blurPixels * 10]
          }
          this.videoContainer.filters = [this.motionBlurFilter]
        } else {
          this.videoContainer.filters = []
        }
      } else {
        this.videoContainer.filters = []
      }
      this.videoContainer.visible = true
    } else {
      this.videoContainer.visible = false
    }

    const visibleAnnotations = precomputed?.visibleAnnotations ?? project.annotations.filter(
      (a: any) => renderTime >= a.time && renderTime <= a.time + a.duration
    )

    if (visibleAnnotations.length > 0) {
      if (this.annotationCanvas.width !== width || this.annotationCanvas.height !== height) {
        this.annotationCanvas.width = width
        this.annotationCanvas.height = height
      }
      this.annotationCtx.clearRect(0, 0, width, height)
      
      for (const annotation of visibleAnnotations) {
        const ax = annotation.x * width
        const ay = annotation.y * height
        this.annotationCtx.save()

        if (annotation.type === 'text') {
          const isCaption = annotation.annotationSource === 'auto-caption'
          this.annotationCtx.font = `bold ${annotation.fontSize || 24}px -apple-system, sans-serif`
          this.annotationCtx.fillStyle = annotation.color
          this.annotationCtx.textAlign = isCaption ? 'center' : 'start'
          this.annotationCtx.textBaseline = isCaption ? 'middle' : 'alphabetic'
          
          if (isCaption) {
            this.annotationCtx.lineWidth = Math.max(2, (annotation.fontSize || 24) * 0.15)
            this.annotationCtx.strokeStyle = 'rgba(0,0,0,0.8)'
            this.annotationCtx.strokeText(annotation.text || '', ax, ay)
            this.annotationCtx.shadowBlur = 0
          } else {
            this.annotationCtx.shadowColor = 'rgba(0,0,0,0.5)'
            this.annotationCtx.shadowBlur = 4
          }
          this.annotationCtx.fillText(annotation.text || '', ax, ay)
          this.annotationCtx.shadowBlur = 0
        } else if (annotation.type === 'arrow' && annotation.endX !== undefined && annotation.endY !== undefined) {
          const ex = annotation.endX * width
          const ey = annotation.endY * height
          const sw = annotation.strokeWidth || 3
          this.annotationCtx.strokeStyle = annotation.color
          this.annotationCtx.lineWidth = sw
          this.annotationCtx.lineCap = 'round'
          this.annotationCtx.beginPath()
          this.annotationCtx.moveTo(ax, ay)
          this.annotationCtx.lineTo(ex, ey)
          this.annotationCtx.stroke()

          const angle = Math.atan2(ey - ay, ex - ax)
          const arrowLen = 16
          this.annotationCtx.beginPath()
          this.annotationCtx.moveTo(ex, ey)
          this.annotationCtx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4))
          this.annotationCtx.moveTo(ex, ey)
          this.annotationCtx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4))
          this.annotationCtx.stroke()
        }
        this.annotationCtx.restore()
      }

      if (this.annotationSprite) {
        this.annotationSprite.texture.source.update()
      } else {
        const tex = Texture.from(this.annotationCanvas)
        this.annotationSprite = new Sprite(tex)
        this.annotationContainer.addChild(this.annotationSprite)
      }
      this.annotationSprite.visible = true
    } else if (this.annotationSprite) {
      this.annotationSprite.visible = false
    }

    if (this.cursorGraphics && project.cursorEvents && project.cursorEvents.length > 0) {
      const smoothingFactor = project.cursorSmoothing ?? 0.5
      const smoothedPath = getSmoothedCursorPath(project.cursorEvents, smoothingFactor)
      const timeMs = renderTime * 1000
      const pos = smoothedPath?.sampleAt(timeMs)
      if (pos) {
        const captureW = project.captureWidth || frame.displayWidth
        const captureH = project.captureHeight || frame.displayHeight
        
        const uncroppedX = (pos.x / captureW) * frame.displayWidth
        const uncroppedY = (pos.y / captureH) * frame.displayHeight
        
        const crop = project.cropSettings
        const srcX = crop ? crop.x * frame.displayWidth : 0
        const srcY = crop ? crop.y * frame.displayHeight : 0
        const srcW = crop ? crop.width * frame.displayWidth : frame.displayWidth
        const srcH = crop ? crop.height * frame.displayHeight : frame.displayHeight
        
        const relX = uncroppedX - srcX
        const relY = uncroppedY - srcY
        
        const normX = relX / srcW
        const normY = relY / srcH
        
        const padding = 16 // RENDER_PADDING_PX
        const availW = Math.max(1, width - padding * 2)
        const availH = Math.max(1, height - padding * 2)
        const ratio = srcW / srcH
        let dw = availW
        let dh = availW / ratio
        if (dh > availH) {
          dh = availH
          dw = availH * ratio
        }
        
        const localX = (normX - 0.5) * dw
        const localY = (normY - 0.5) * dh
        
        if (normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1) {
          this.cursorGraphics.visible = true
          this.cursorGraphics.position.set(localX, localY)
          
          const { scale } = precomputed?.zoomTransform ?? getZoomTransformAtTime(project.zoomKeyframes, renderTime)
          const baseCursorScale = 1.5
          this.cursorGraphics.scale.set(baseCursorScale / scale)
        } else {
          this.cursorGraphics.visible = false
        }
      } else {
        this.cursorGraphics.visible = false
      }
    } else if (this.cursorGraphics) {
      this.cursorGraphics.visible = false
    }

    this.app.render()
  }
}
