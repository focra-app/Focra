const FETCH_TIMEOUT_MS = 120_000

async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    window.clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { length, numberOfChannels } = audioBuffer
  const out = new Float32Array(length)
  if (numberOfChannels === 0) return out
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (let c = 0; c < numberOfChannels; c++) {
      sum += audioBuffer.getChannelData(c)[i]
    }
    out[i] = sum / numberOfChannels
  }
  return out
}

async function resampleMono(
  mono: Float32Array,
  fromRate: number,
  toRate: number,
  signal?: AbortSignal
): Promise<Float32Array> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (fromRate === toRate) return mono
  const durationSec = mono.length / fromRate
  const outLength = Math.max(1, Math.ceil(durationSec * toRate))
  const offline = new window.OfflineAudioContext(1, outLength, toRate)
  const buf = offline.createBuffer(1, mono.length, fromRate)
  buf.copyToChannel(Float32Array.from(mono), 0)
  const src = offline.createBufferSource()
  src.buffer = buf
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return rendered.getChannelData(0).slice()
}

export async function extractMono16kFromVideoUrl(
  videoUrl: string,
  options?: { signal?: AbortSignal }
): Promise<{ samples: Float32Array; durationSec: number }> {
  const response = await fetchWithTimeout(videoUrl, options?.signal)
  if (!response.ok) {
    throw new Error(`Failed to load video for captions: ${response.status} ${response.statusText}`)
  }
  const ab = await response.arrayBuffer()
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const audioContext = new window.AudioContext()
  try {
    const audioBuffer = await audioContext.decodeAudioData(ab)
    if (
      audioBuffer.numberOfChannels === 0 ||
      audioBuffer.length === 0 ||
      !Number.isFinite(audioBuffer.duration) ||
      audioBuffer.duration <= 0
    ) {
      throw new Error('Invalid audio data')
    }
    const mono = mixToMono(audioBuffer)
    const fromRate = audioBuffer.sampleRate
    
    // Whisper requires 16kHz audio
    const samples = await resampleMono(mono, fromRate, 16000, options?.signal)
    
    return { samples, durationSec: samples.length / 16000 }
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}
