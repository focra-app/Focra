import type { TranscribeWorkerRequest, TranscribeWorkerResponse } from './transcribe'
import { runTranscription, type TranscriberFn } from './transcribeCore'

function post(message: TranscribeWorkerResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

function withoutNodeVersion<T>(fn: () => Promise<T>): Promise<T> {
  const versions =
    typeof process !== 'undefined' && process.versions && typeof process.versions === 'object'
      ? process.versions
      : null
  const hadNode = versions !== null && 'node' in versions
  const savedNode = hadNode ? (versions as { node?: string }).node : undefined
  if (hadNode && versions) {
    try {
      Reflect.deleteProperty(versions, 'node')
    } catch {
      ;(versions as { node?: string }).node = undefined
    }
  }
  return fn().finally(() => {
    if (hadNode && versions && savedNode !== undefined) {
      ;(versions as { node: string }).node = savedNode
    }
  })
}

// @ts-ignore
import { pipeline, env } from '@xenova/transformers'

async function loadTranscriber(): Promise<TranscriberFn> {
  return withoutNodeVersion(async () => {
    env.allowLocalModels = true
    const transcriber = (await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en'
    )) as unknown as TranscriberFn
    return transcriber
  })
}

self.onmessage = async (event: MessageEvent<TranscribeWorkerRequest>) => {
  const { samples } = event.data
  try {
    post({ type: 'status', phase: 'model' })
    const transcriber = await loadTranscriber()

    post({ type: 'status', phase: 'transcribe' })
    const { segments, granularity } = await runTranscription(transcriber, samples)

    post({ type: 'result', segments, granularity })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
