import type { ZoomKeyframe } from '../../types'

export type ZoomTransform = {
  scale: number
  tx: number
  ty: number
  motionBlur: boolean
}

export function cubicEase(t: number, easing: ZoomKeyframe['easing']): number {
  switch (easing) {
    case 'ease-in': return t * t * t
    case 'ease-out': return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    default: return t
  }
}

export function getZoomTransformFromKeyframe(kf: ZoomKeyframe, time: number): ZoomTransform {
  const inTime = kf.time
  const outTime = kf.time + kf.duration
  const halfDur = kf.duration * 0.25

  let scale = 1

  if (time < inTime + halfDur) {
    const progress = (time - inTime) / halfDur
    scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
  } else if (time > outTime - halfDur) {
    const progress = (outTime - time) / halfDur
    scale = 1 + (kf.scale - 1) * cubicEase(progress, kf.easing)
  } else {
    scale = kf.scale
  }

  const tx = (0.5 - kf.x) * (scale - 1)
  const ty = (0.5 - kf.y) * (scale - 1)

  return { scale, tx, ty, motionBlur: kf.motionBlur && scale > 1.05 }
}

export function getZoomTransformAtTime(keyframes: ZoomKeyframe[], time: number): ZoomTransform {
  const activeKeyframe = keyframes.reduce<ZoomKeyframe | null>((latest, kf) => {
    const inTime = kf.time
    const outTime = kf.time + kf.duration
    if (time < inTime || time > outTime) return latest
    if (latest === null || kf.time > latest.time) return kf
    return latest
  }, null)

  if (!activeKeyframe) {
    return { scale: 1, tx: 0, ty: 0, motionBlur: false }
  }

  return getZoomTransformFromKeyframe(activeKeyframe, time)
}
