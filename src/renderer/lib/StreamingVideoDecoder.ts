import { WebDemuxer } from "web-demuxer";
import wasmUrl from './wasm/web-demuxer.wasm?url';
import type { TrimPoints } from "../types";

const SOURCE_LOAD_TIMEOUT_MS = 60_000;
const EPSILON_SEC = 0.001;

function buildAV1CodecString(description?: BufferSource): string {
  const fallback = "av01.0.01M.08";
  if (!description) return fallback;

  const bytes =
    description instanceof ArrayBuffer
      ? new Uint8Array(description)
      : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);

  if (bytes.length < 4) return fallback;
  if (!(bytes[0] & 0x80)) return fallback; // marker bit must be 1

  const profile = (bytes[1] >> 5) & 0x07;
  const level = bytes[1] & 0x1f;
  const tier = (bytes[2] >> 7) & 0x01;
  const highBitdepth = (bytes[2] >> 6) & 0x01;
  const twelveBit = (bytes[2] >> 5) & 0x01;
  let bitdepth = 8;
  if (highBitdepth) bitdepth = twelveBit ? 12 : 10;

  const tierChar = tier ? "H" : "M";
  const levelStr = level.toString().padStart(2, "0");
  const bitdepthStr = bitdepth.toString().padStart(2, "0");

  return `av01.${profile}.${levelStr}${tierChar}.${bitdepthStr}`;
}

export interface DecodedVideoInfo {
  width: number;
  height: number;
  duration: number; // seconds
  streamDuration?: number; // seconds
  frameRate: number;
  codec: string;
  hasAudio: boolean;
  audioCodec?: string;
}

type EarlyDecodeEndCheck = {
  cancelled: boolean;
  lastDecodedFrameSec: number | null;
  requiredEndSec: number;
  streamDurationSec?: number;
};

const EARLY_DECODE_END_THRESHOLD_SEC = 1;
const METADATA_TAIL_TOLERANCE_SEC = 2;
const STREAM_DURATION_MATCH_TOLERANCE_SEC = 0.25;
const DURATION_DIVERGENCE_THRESHOLD_SEC = 1.5;
const SCAN_UNBOUNDED_FALLBACK_SEC = 24 * 60 * 60;

export function validateDuration(containerDuration: number, scannedDuration: number): number {
  if (scannedDuration <= 0) {
    return Number.isFinite(containerDuration) ? Math.max(containerDuration, 0) : 0;
  }
  if (!Number.isFinite(containerDuration) || containerDuration <= 0) {
    return scannedDuration;
  }
  if (Math.abs(containerDuration - scannedDuration) > DURATION_DIVERGENCE_THRESHOLD_SEC) {
    return scannedDuration;
  }
  return containerDuration;
}

export function shouldFailDecodeEndedEarly({
  cancelled,
  lastDecodedFrameSec,
  requiredEndSec,
  streamDurationSec,
}: EarlyDecodeEndCheck): boolean {
  if (cancelled || requiredEndSec <= 0) {
    return false;
  }

  if (lastDecodedFrameSec === null) {
    return true;
  }

  const decodeGapSec = requiredEndSec - lastDecodedFrameSec;
  if (decodeGapSec <= EARLY_DECODE_END_THRESHOLD_SEC) {
    return false;
  }

  if (typeof streamDurationSec !== "number" || !Number.isFinite(streamDurationSec)) {
    return true;
  }

  const metadataTailSec = requiredEndSec - streamDurationSec;
  const decodedNearStreamEnd =
    Math.abs(lastDecodedFrameSec - streamDurationSec) <= STREAM_DURATION_MATCH_TOLERANCE_SEC;

  const maxTailSec = Math.max(METADATA_TAIL_TOLERANCE_SEC, requiredEndSec * 0.01);
  if (decodedNearStreamEnd && metadataTailSec > 0 && metadataTailSec <= maxTailSec) {
    return false;
  }

  return true;
}

type OnFrameCallback = (
  frame: VideoFrame,
  exportTimestampUs: number,
  sourceTimestampMs: number,
) => Promise<void>;

export class StreamingVideoDecoder {
  private demuxer: WebDemuxer | null = null;
  private decoder: VideoDecoder | null = null;
  private cancelled = false;
  private metadata: DecodedVideoInfo | null = null;

  static async loadRemoteSourceFile(videoUrl: string): Promise<{ file: File; blob: Blob }> {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch source video: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const filename = videoUrl.split("/").pop() || "video";
    return {
      blob,
      file: new File([blob], filename, { type: blob.type }),
    };
  }

  async loadMetadata(videoUrl: string): Promise<DecodedVideoInfo> {
    const { file } = await this.withTimeout(
      StreamingVideoDecoder.loadRemoteSourceFile(videoUrl),
      SOURCE_LOAD_TIMEOUT_MS,
      "Timed out while loading the source video."
    );

    const absoluteWasmUrl = new URL(wasmUrl, import.meta.url).href;
    this.demuxer = new WebDemuxer({ wasmFilePath: absoluteWasmUrl });
    await this.withTimeout(
      this.demuxer.load(file),
      SOURCE_LOAD_TIMEOUT_MS,
      "Timed out while parsing the source video.",
    );

    const mediaInfo = await this.withTimeout(
      this.demuxer.getMediaInfo(),
      SOURCE_LOAD_TIMEOUT_MS,
      "Timed out while reading video metadata.",
    );
    const videoStream = mediaInfo.streams.find((s) => s.codec_type_string === "video");

    let frameRate = 60;
    if (videoStream?.avg_frame_rate) {
      const parts = videoStream.avg_frame_rate.split("/");
      if (parts.length === 2) {
        const num = parseInt(parts[0], 10);
        const den = parseInt(parts[1], 10);
        if (den > 0 && num > 0) frameRate = num / den;
      }
    }

    const audioStream = mediaInfo.streams.find((s) => s.codec_type_string === "audio");

    const containerDurationSec = Number.isFinite(mediaInfo.duration) ? mediaInfo.duration : 0;
    const streamDurationSec =
      typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
        ? videoStream.duration
        : 0;
    const hintedDurationSec = Math.max(containerDurationSec, streamDurationSec, 0);
    const scanEndSec =
      hintedDurationSec > 0 ? hintedDurationSec + 0.5 : SCAN_UNBOUNDED_FALLBACK_SEC;
    let maxPacketEndUs = 0;
    const scanReader = this.demuxer.read("video", 0, scanEndSec).getReader();
    try {
      while (true) {
        const { done, value } = await scanReader.read();
        if (done || !value) break;
        const endUs = value.timestamp + (value.duration ?? 0);
        if (endUs > maxPacketEndUs) maxPacketEndUs = endUs;
      }
    } finally {
      try {
        await scanReader.cancel();
      } catch {
        // already closed
      }
    }
    const scannedDuration = maxPacketEndUs / 1_000_000;
    const validatedDuration = validateDuration(mediaInfo.duration, scannedDuration);

    this.metadata = {
      width: videoStream?.width || 1920,
      height: videoStream?.height || 1080,
      duration: validatedDuration,
      streamDuration:
        typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
          ? videoStream.duration
          : undefined,
      frameRate,
      codec: videoStream?.codec_string || "unknown",
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_string,
    };

    return this.metadata;
  }

  async decodeAll(
    targetFrameRate: number,
    trimPoints: TrimPoints,
    onFrame: OnFrameCallback,
    onWarning?: (message: string) => void,
  ): Promise<void> {
    if (!this.demuxer || !this.metadata) {
      throw new Error("Must call loadMetadata() before decodeAll()");
    }

    const decoderConfig = await this.demuxer.getDecoderConfig("video");

    if (/^av01$/i.test(decoderConfig.codec)) {
      decoderConfig.codec = buildAV1CodecString(
        decoderConfig.description as BufferSource | undefined,
      );
    }
    if (/^vp08$/i.test(decoderConfig.codec)) decoderConfig.codec = "vp8";
    if (/^vp09$/i.test(decoderConfig.codec)) decoderConfig.codec = "vp9";
    if (/^avc1$/i.test(decoderConfig.codec)) decoderConfig.codec = "avc1.640033";
    if (/^h264$/i.test(decoderConfig.codec)) decoderConfig.codec = "avc1.640033";

    const codec = decoderConfig.codec.toLowerCase();
    const shouldPreferSoftwareDecode =
      codec.includes("av01") ||
      codec.includes("av1") ||
      codec.includes("vp09") ||
      codec.includes("vp9");

    const startSec = Math.max(0, trimPoints.inPoint);
    const endSec = Math.min(this.metadata.duration, trimPoints.outPoint);
    const requiredEndSec = endSec;

    const segmentFrameCount = Math.ceil(
      ((endSec - startSec - EPSILON_SEC) / 1) * targetFrameRate,
    );
    const frameDurationUs = 1_000_000 / targetFrameRate;

    const pendingFrames: VideoFrame[] = [];
    let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
    let decodeError: Error | null = null;
    let decodeDone = false;

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(frame);
        } else {
          pendingFrames.push(frame);
        }
      },
      error: (e: DOMException) => {
        decodeError = new Error(`VideoDecoder error: ${e.message}`);
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      },
    });

    const preferredDecoderConfig = shouldPreferSoftwareDecode
      ? {
          ...decoderConfig,
          hardwareAcceleration: "prefer-software" as const,
        }
      : decoderConfig;

    try {
      const support = await VideoDecoder.isConfigSupported(preferredDecoderConfig);
      if (!support.supported) {
        throw new Error(`Unsupported codec: ${preferredDecoderConfig.codec}`);
      }
      this.decoder.configure(preferredDecoderConfig);
    } catch (error) {
      if (shouldPreferSoftwareDecode) {
        this.decoder.configure(decoderConfig);
      } else if (/^avc1/i.test(codec)) {
        const fallback = { ...decoderConfig, codec: "avc1.640033" };
        this.decoder.configure(fallback);
      } else {
        throw error;
      }
    }

    const getNextFrame = (): Promise<VideoFrame | null> => {
      if (decodeError) throw decodeError;
      if (pendingFrames.length > 0) return Promise.resolve(pendingFrames.shift()!);
      if (decodeDone) return Promise.resolve(null);
      return new Promise((resolve) => {
        frameResolve = resolve;
      });
    };

    const readEndSec = this.metadata.duration + 0.5;
    const reader = this.demuxer.read("video", 0, readEndSec).getReader();

    const feedPromise = (async () => {
      try {
        while (!this.cancelled) {
          const { done, value: chunk } = await reader.read();
          if (done || !chunk) break;
          while (
            (this.decoder!.decodeQueueSize > 10 || pendingFrames.length > 24) &&
            !this.cancelled
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          if (this.cancelled) break;
          this.decoder!.decode(chunk);
        }
        if (!this.cancelled && this.decoder!.state === "configured") {
          await this.decoder!.flush();
        }
      } catch (e) {
        decodeError = e instanceof Error ? e : new Error(String(e));
      } finally {
        decodeDone = true;
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      }
    })();

    let segmentFrameIndex = 0;
    let exportFrameIndex = 0;
    let lastDecodedFrameSec: number | null = null;
    let heldFrame: VideoFrame | null = null;
    let heldFrameSec = 0;

    const emitHeldFrameForTarget = async () => {
      if (!heldFrame) return false;
      if (segmentFrameIndex >= segmentFrameCount) return false;

      const sourceTimeSec = startSec + (segmentFrameIndex / targetFrameRate);
      if (sourceTimeSec >= endSec - EPSILON_SEC) return false;

      const clone = new VideoFrame(heldFrame, { timestamp: heldFrame.timestamp });
      await onFrame(clone, exportFrameIndex * frameDurationUs, sourceTimeSec * 1000);
      segmentFrameIndex++;
      exportFrameIndex++;
      return true;
    };

    while (!this.cancelled) {
      const frame = await getNextFrame();
      if (!frame) break;

      const frameTimeSec = frame.timestamp / 1_000_000;
      lastDecodedFrameSec = frameTimeSec;

      if (frameTimeSec >= endSec - EPSILON_SEC) {
        while (!this.cancelled && (await emitHeldFrameForTarget())) {}
        frame.close();
        continue;
      }

      if (frameTimeSec < startSec - EPSILON_SEC) {
        frame.close();
        continue;
      }

      if (!heldFrame) {
        heldFrame = frame;
        heldFrameSec = frameTimeSec;
        continue;
      }

      const handoffBoundarySec = (heldFrameSec + frameTimeSec) / 2;
      while (!this.cancelled) {
        if (segmentFrameIndex >= segmentFrameCount) {
          break;
        }

        const sourceTimeSec = startSec + (segmentFrameIndex / targetFrameRate);
        if (sourceTimeSec >= endSec - EPSILON_SEC) {
          break;
        }
        if (sourceTimeSec > handoffBoundarySec) {
          break;
        }

        const clone = new VideoFrame(heldFrame, { timestamp: heldFrame.timestamp });
        await onFrame(clone, exportFrameIndex * frameDurationUs, sourceTimeSec * 1000);
        segmentFrameIndex++;
        exportFrameIndex++;
      }

      heldFrame.close();
      heldFrame = frame;
      heldFrameSec = frameTimeSec;
    }

    if (heldFrame) {
      while (!this.cancelled) {
        const sourceTimeSec = startSec + (segmentFrameIndex / targetFrameRate);
        if (sourceTimeSec >= endSec - EPSILON_SEC) {
          break;
        }
        while (!this.cancelled && (await emitHeldFrameForTarget())) {}
        break;
      }
      heldFrame.close();
      heldFrame = null;
    }

    while (!decodeDone) {
      const frame = await getNextFrame();
      if (!frame) break;
      frame.close();
    }

    try {
      reader.cancel();
    } catch {}
    await feedPromise;
    for (const f of pendingFrames) f.close();
    pendingFrames.length = 0;

    if (this.decoder?.state === "configured") {
      this.decoder.close();
    }
    this.decoder = null;

    if (
      shouldFailDecodeEndedEarly({
        cancelled: this.cancelled,
        lastDecodedFrameSec,
        requiredEndSec,
        streamDurationSec: this.metadata.streamDuration,
      })
    ) {
      const decodedAtLabel =
        lastDecodedFrameSec === null ? "no decoded frame" : `${lastDecodedFrameSec.toFixed(3)}s`;
      const message = `Decode ended early at ${decodedAtLabel} (needed ${requiredEndSec.toFixed(3)}s) – export may be slightly shorter than expected.`;
      console.warn(`[StreamingVideoDecoder] ${message}`);
      onWarning?.(message);
    }
  }

  getDemuxer(): WebDemuxer | null {
    return this.demuxer;
  }

  cancel(): void {
    this.cancelled = true;
  }

  destroy(): void {
    this.cancelled = true;
    if (this.decoder) {
      try {
        if (this.decoder.state === "configured") this.decoder.close();
      } catch {}
      this.decoder = null;
    }
    if (this.demuxer) {
      try {
        this.demuxer.destroy();
      } catch {}
      this.demuxer = null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
