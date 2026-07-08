export interface CaptionSegment {
  startSec: number
  endSec: number
  text: string
}

export type CaptionTimestampGranularity = 'word' | 'phrase'

export interface TranscribeMono16kResult {
  segments: CaptionSegment[]
  granularity: CaptionTimestampGranularity
}

export interface TranscribeWorkerRequest {
  samples: Float32Array
}

export type TranscribeWorkerResponse =
  | { type: 'status'; phase: 'model' | 'transcribe' }
  | { type: 'result'; segments: CaptionSegment[]; granularity: CaptionTimestampGranularity }
  | { type: 'error'; message: string }

// @ts-ignore
import TranscribeWorker from './transcribe.worker?worker'

export function transcribeMono16kToSegments(
  samples: Float32Array,
  options?: {
    onStatus?: (phase: 'model' | 'transcribe') => void
    signal?: AbortSignal
  }
): Promise<TranscribeMono16kResult> {
  if (options?.signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise<TranscribeMono16kResult>((resolve, reject) => {
    const worker = new TranscribeWorker()

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      options?.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }

    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    options?.signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent<TranscribeWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'status') {
        options?.onStatus?.(msg.phase)
        return
      }
      if (msg.type === 'result') {
        finish(() => resolve({ segments: msg.segments, granularity: msg.granularity }))
        return
      }
      finish(() => reject(new Error(msg.message)))
    }

    worker.onerror = (e: ErrorEvent) => {
      finish(() => reject(new Error(e.message || 'Caption transcription worker failed')))
    }

    const request: TranscribeWorkerRequest = {
      samples
    }
    worker.postMessage(request)
  })
}
