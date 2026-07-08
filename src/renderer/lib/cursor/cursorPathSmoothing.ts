import type { MouseEventData } from '../../types'

export interface SmoothedCursorPosition {
  x: number
  y: number
}

export interface SmoothedCursorPath {
  sampleAt(timeMs: number): SmoothedCursorPosition | null
}

const STEP_MS = 1000 / 240
const STEP_S = STEP_MS / 1000

interface SmoothedRun {
  start: number
  end: number
  times: Float32Array
  xs: Float32Array
  ys: Float32Array
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getCursorSpringConfig(smoothingFactor: number) {
  const clamped = Math.min(1, Math.max(0, smoothingFactor))
  
  if (clamped <= 0) {
    return { stiffness: 1000, damping: 100, mass: 1 }
  }

  // Linear interpolation for stiffness/damping based on factor
  return {
    stiffness: 760 - clamped * 420,
    damping: 34 + clamped * 24,
    mass: 0.55 + clamped * 0.45
  }
}

function binarySearchAtOrBefore(
  times: Float32Array | number[],
  timeMs: number,
  hi: number
): number {
  let low = 0
  let high = hi
  let result = -1
  while (low <= high) {
    const mid = low + ((high - low) >> 1)
    if (times[mid] <= timeMs) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

function interpolateRun(samples: MouseEventData[], timeMs: number): SmoothedCursorPosition {
  const last = samples.length - 1
  if (timeMs <= samples[0].timestamp) return { x: samples[0].x, y: samples[0].y }
  if (timeMs >= samples[last].timestamp) return { x: samples[last].x, y: samples[last].y }
  const i = binarySearchAtOrBefore(
    samples.map((s) => s.timestamp),
    timeMs,
    last
  )
  const a = samples[i]
  const b = samples[i + 1] ?? a
  const span = b.timestamp - a.timestamp
  if (span <= 0) return { x: a.x, y: a.y }
  const t = (timeMs - a.timestamp) / span
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function springSmooth(
  targets: Float32Array,
  stiffness: number,
  damping: number,
  mass: number
): Float32Array {
  const out = new Float32Array(targets.length)
  if (targets.length === 0) return out
  let x = targets[0]
  let v = 0
  out[0] = x
  for (let i = 1; i < targets.length; i++) {
    const accel = (-stiffness * (x - targets[i]) - damping * v) / mass
    v += accel * STEP_S
    x += v * STEP_S
    out[i] = x
  }
  return out
}

function buildSmoothedRun(
  samples: MouseEventData[],
  stiffness: number,
  damping: number,
  mass: number
): SmoothedRun {
  const start = samples[0].timestamp
  const end = samples[samples.length - 1].timestamp
  const stepCount = Math.max(1, Math.round((end - start) / STEP_MS))
  const n = stepCount + 1
  const times = new Float32Array(n)
  const rawX = new Float32Array(n)
  const rawY = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i === n - 1 ? end : start + i * STEP_MS
    times[i] = t
    const p = interpolateRun(samples, t)
    rawX[i] = p.x
    rawY[i] = p.y
  }
  return {
    start,
    end,
    times,
    xs: springSmooth(rawX, stiffness, damping, mass),
    ys: springSmooth(rawY, stiffness, damping, mass)
  }
}

function sampleRun(run: SmoothedRun, timeMs: number): SmoothedCursorPosition {
  const last = run.times.length - 1
  if (timeMs <= run.times[0]) return { x: run.xs[0], y: run.ys[0] }
  if (timeMs >= run.times[last]) return { x: run.xs[last], y: run.ys[last] }
  const i = binarySearchAtOrBefore(run.times, timeMs, last)
  const span = run.times[i + 1] - run.times[i]
  if (span <= 0) return { x: run.xs[i], y: run.ys[i] }
  const t = (timeMs - run.times[i]) / span
  return {
    x: run.xs[i] + (run.xs[i + 1] - run.xs[i]) * t,
    y: run.ys[i] + (run.ys[i + 1] - run.ys[i]) * t
  }
}

function buildRawPath(samples: MouseEventData[]): SmoothedCursorPath {
  return {
    sampleAt(timeMs) {
      if (samples.length === 0) return null
      if (timeMs >= samples[0].timestamp && timeMs <= samples[samples.length - 1].timestamp) {
        return interpolateRun(samples, timeMs)
      }
      return null
    }
  }
}

function buildSmoothedPath(
  samples: MouseEventData[],
  smoothing01: number
): SmoothedCursorPath {
  if (samples.length === 0) {
    return { sampleAt: () => null }
  }
  if (smoothing01 <= 0) {
    return buildRawPath(samples)
  }

  const config = getCursorSpringConfig(clamp(smoothing01, 0, 1))

  const smoothedRun = samples.length < 2
    ? {
        start: samples[0].timestamp,
        end: samples[0].timestamp,
        times: new Float32Array([samples[0].timestamp]),
        xs: new Float32Array([samples[0].x]),
        ys: new Float32Array([samples[0].y])
      }
    : buildSmoothedRun(samples, config.stiffness, config.damping, config.mass)

  return {
    sampleAt(timeMs) {
      if (timeMs >= smoothedRun.start && timeMs <= smoothedRun.end) return sampleRun(smoothedRun, timeMs)
      return null
    }
  }
}

const pathCache = new WeakMap<MouseEventData[], Map<string, SmoothedCursorPath>>()

export function getSmoothedCursorPath(
  samples: MouseEventData[] | null | undefined,
  smoothing01: number
): SmoothedCursorPath | null {
  if (!samples || samples.length === 0) return null
  const key = (Number.isFinite(smoothing01) ? clamp(smoothing01, 0, 1) : 0).toFixed(2)
  let byStrength = pathCache.get(samples)
  if (!byStrength) {
    byStrength = new Map()
    pathCache.set(samples, byStrength)
  }
  let path = byStrength.get(key)
  if (!path) {
    path = buildSmoothedPath(samples, Number.parseFloat(key))
    byStrength.set(key, path)
  }
  return path
}
