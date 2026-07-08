import type { CaptionSegment } from './transcribe'
import type { Annotation } from '../../types'

function generateId() {
  return `caption-${Math.random().toString(36).substr(2, 9)}`
}

export function formatCaptions(segments: CaptionSegment[]): Annotation[] {
  return segments.map((seg) => {
    return {
      id: generateId(),
      type: 'text',
      annotationSource: 'auto-caption',
      time: seg.startSec,
      duration: seg.endSec - seg.startSec,
      x: 0.5, // Center horizontally
      y: 0.85, // Near bottom
      text: seg.text,
      fontSize: 24, // Will be overridden or used as base
      color: '#ffffff'
    }
  })
}
