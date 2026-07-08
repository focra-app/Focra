import type { CaptionSegment, TranscribeMono16kResult } from './transcribe'

export type TranscriberFn = (
  audio: Float32Array,
  opts: Record<string, unknown>
) => Promise<unknown>

const TRANSCRIBE_SLICE_SAMPLES = 12 * 60 * 16_000
const MIN_TRANSCRIBE_SLICE_SAMPLES = 800

function padTailSliceForTranscribe(samples: Float32Array): {
  slice: Float32Array
  realDurationSec: number
} {
  const realDurationSec = samples.length / 16_000
  if (samples.length >= MIN_TRANSCRIBE_SLICE_SAMPLES) {
    return { slice: samples, realDurationSec }
  }
  const padded = new Float32Array(MIN_TRANSCRIBE_SLICE_SAMPLES)
  padded.set(samples)
  return { slice: padded, realDurationSec }
}

function segmentsFromTranscriberChunks(
  chunks: Array<{ timestamp?: [number | null, number | null]; text?: unknown }>,
  timeOffsetSec: number,
  audioDurationSec: number
): CaptionSegment[] {
  const sorted = [...chunks].sort((x, y) => {
    const ax = x.timestamp?.[0]
    const ay = y.timestamp?.[0]
    const na = typeof ax === 'number' ? ax : -1
    const nb = typeof ay === 'number' ? ay : -1
    return na - nb
  })

  const segments: CaptionSegment[] = []

  for (let idx = 0; idx < sorted.length; idx++) {
    const c = sorted[idx]
    const ts = c.timestamp as [number | null, number | null] | undefined
    if (!ts) continue
    let a = ts[0]
    let b = ts[1]
    if (a == null) a = 0
    a = Math.max(0, a)
    if (b == null) {
      let nextStart: number | null = null
      for (let j = idx + 1; j < sorted.length; j++) {
        const na = sorted[j]?.timestamp?.[0]
        if (typeof na === 'number') {
          nextStart = na
          break
        }
      }
      b = nextStart ?? audioDurationSec
    }
    if (b <= a) {
      b = Math.min(a + 0.25, audioDurationSec)
    }
    b = Math.min(b, audioDurationSec)

    const text = String(c.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue

    const startSec = a + timeOffsetSec
    const sliceEnd = timeOffsetSec + audioDurationSec
    const endSec = Math.min(Math.max(startSec + 0.08, b + timeOffsetSec), sliceEnd)

    segments.push({ startSec, endSec, text })
  }

  segments.sort((u, v) => u.startSec - v.startSec || u.endSec - v.endSec)
  const rawDeduped: CaptionSegment[] = []
  for (const seg of segments) {
    const prev = rawDeduped[rawDeduped.length - 1]
    if (prev && prev.text === seg.text && seg.startSec <= prev.endSec) {
      prev.endSec = Math.max(prev.endSec, seg.endSec)
      prev.startSec = Math.min(prev.startSec, seg.startSec)
      continue
    }
    rawDeduped.push(seg)
  }
  return rawDeduped
}

async function runTranscriberOnSlice(
  transcriber: TranscriberFn,
  samples: Float32Array,
  opts: { forceFullSequences: boolean; timestampMode: 'word' | 'phrase' }
): Promise<unknown> {
  const durationSec = samples.length / 16_000
  const chunking = durationSec > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}
  return transcriber(samples, {
    return_timestamps: opts.timestampMode === 'word' ? 'word' : true,
    force_full_sequences: opts.forceFullSequences,
    ...chunking
  })
}

function getChunksFromTranscriberResult(result: unknown): Array<{
  timestamp?: [number | null, number | null]
  text?: unknown
}> {
  if (result == null) return []
  if (Array.isArray(result)) {
    const out: Array<{ timestamp?: [number | null, number | null]; text?: unknown }> = []
    for (const item of result) {
      const chunks = (item as { chunks?: unknown })?.chunks
      if (Array.isArray(chunks)) out.push(...chunks)
    }
    return out
  }
  const chunks = (result as { chunks?: unknown })?.chunks
  return Array.isArray(chunks) ? chunks : []
}

function extractChunksFromAsrResult(result: unknown): Array<{
  timestamp?: [number | null, number | null]
  text?: unknown
}> {
  const fromChunks = getChunksFromTranscriberResult(result)
  if (fromChunks.length > 0) return fromChunks
  const single = Array.isArray(result) ? result[0] : result
  const text =
    typeof (single as { text?: unknown })?.text === 'string'
      ? String((single as { text: string }).text).trim()
      : ''
  if (text) {
    return [{ timestamp: [0, null], text }]
  }
  return []
}

export async function runTranscription(
  transcriber: TranscriberFn,
  samples: Float32Array
): Promise<TranscribeMono16kResult> {
  const transcribeOne = async (
    forceFullSequences: boolean,
    timestampMode: 'word' | 'phrase'
  ): Promise<CaptionSegment[]> => {
    try {
      if (samples.length <= TRANSCRIBE_SLICE_SAMPLES) {
        const { slice, realDurationSec } = padTailSliceForTranscribe(samples)
        const result = await runTranscriberOnSlice(transcriber, slice, {
          forceFullSequences,
          timestampMode
        })
        return segmentsFromTranscriberChunks(
          extractChunksFromAsrResult(result),
          0,
          realDurationSec
        )
      }

      const all: CaptionSegment[] = []
      for (let offset = 0; offset < samples.length; offset += TRANSCRIBE_SLICE_SAMPLES) {
        const end = Math.min(offset + TRANSCRIBE_SLICE_SAMPLES, samples.length)
        const sliceRaw = samples.subarray(offset, end)
        const isFinalSlice = end >= samples.length
        if (sliceRaw.length === 0) continue
        if (sliceRaw.length < MIN_TRANSCRIBE_SLICE_SAMPLES && !isFinalSlice) continue

        const { slice, realDurationSec } =
          sliceRaw.length < MIN_TRANSCRIBE_SLICE_SAMPLES && isFinalSlice
            ? padTailSliceForTranscribe(sliceRaw)
            : { slice: sliceRaw, realDurationSec: sliceRaw.length / 16_000 }

        const result = await runTranscriberOnSlice(transcriber, slice, {
          forceFullSequences,
          timestampMode
        })
        const tOff = offset / 16_000
        all.push(
          ...segmentsFromTranscriberChunks(
            extractChunksFromAsrResult(result),
            tOff,
            realDurationSec
          )
        )
      }
      return all
    } catch (e) {
      console.warn('[captioning] Whisper pass failed:', e)
      return []
    }
  }

  const attemptModes: Array<'word' | 'phrase'> = ['word', 'phrase']
  for (const timestampMode of attemptModes) {
    let segments = await transcribeOne(true, timestampMode)
    if (segments.length === 0) {
      segments = await transcribeOne(false, timestampMode)
    }
    if (segments.length > 0) {
      return { segments, granularity: timestampMode }
    }
  }

  return { segments: [], granularity: 'phrase' }
}
