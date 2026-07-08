import { useState, useRef } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { Subtitles, Wand2, Trash2 } from 'lucide-react'
import { extractMono16kFromVideoUrl } from '../../lib/captioning/extractAudio'
import { transcribeMono16kToSegments } from '../../lib/captioning/transcribe'
import { formatCaptions } from '../../lib/captioning/formatCaptions'

export default function CaptionsPanel() {
  const { project, addAnnotation, updateAnnotation, deleteAnnotation, currentTime, setCurrentTime } = useEditorStore()
  const [isGenerating, setIsGenerating] = useState(false)
  const [status, setStatus] = useState<string>('')
  const abortControllerRef = useRef<AbortController | null>(null)

  if (!project) return null

  const handleGenerate = async () => {
    if (isGenerating) return

    try {
      setIsGenerating(true)
      setStatus('Extracting audio...')
      
      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal

      const { samples } = await extractMono16kFromVideoUrl(project.videoUrl, { signal })
      
      setStatus('Loading AI model...')
      const result = await transcribeMono16kToSegments(samples, {
        signal,
        onStatus: (phase) => {
          if (phase === 'model') setStatus('Loading Whisper AI model (this takes a moment)...')
          else if (phase === 'transcribe') setStatus('Transcribing audio...')
        }
      })

      setStatus('Formatting captions...')
      const newCaptions = formatCaptions(result.segments)
      
      // Remove old auto-captions
      project.annotations
        .filter(a => a.annotationSource === 'auto-caption')
        .forEach(a => deleteAnnotation(a.id))

      // Add all new captions to the project
      newCaptions.forEach(caption => addAnnotation(caption))
      
      setStatus('')
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Transcription failed:', e)
        alert('Transcription failed: ' + e.message)
      }
      setStatus('')
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  // Filter only auto-captions for this panel
  const captions = project.annotations
    .filter(a => a.annotationSource === 'auto-caption')
    .sort((a, b) => a.time - b.time)

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Subtitles size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary">Auto Captions</span>
      </div>

      <div className="flex-shrink-0">
        <p className="text-xs text-text-muted bg-bg-tertiary rounded-lg p-3 mb-3">
          Automatically generate captions for your video using AI. The processing happens entirely on your device for privacy.
        </p>

        {isGenerating ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center justify-center p-4 bg-bg-tertiary rounded-lg border border-border">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mb-3" />
              <p className="text-xs text-text-secondary text-center">{status}</p>
            </div>
            <button
              onClick={handleCancel}
              className="btn-secondary w-full text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2 py-2"
          >
            <Wand2 size={16} />
            Generate Captions
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 pb-4">
        {captions.length > 0 && (
          <div className="text-xs font-semibold text-text-secondary mb-2 sticky top-0 bg-bg-secondary py-1 z-10">
            Generated Captions ({captions.length})
          </div>
        )}
        
        {captions.map(caption => (
          <div 
            key={caption.id}
            className={`p-3 rounded-lg border flex flex-col gap-2 transition-colors ${currentTime >= caption.time && currentTime < caption.time + caption.duration ? 'bg-accent/10 border-accent/30' : 'bg-bg-tertiary border-border'}`}
            onClick={() => setCurrentTime(caption.time)}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-text-muted">
                {caption.time.toFixed(1)}s - {(caption.time + caption.duration).toFixed(1)}s
              </span>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteAnnotation(caption.id); }}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
                title="Delete caption"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <textarea
              className="w-full bg-bg-primary text-text-primary text-sm p-2 rounded border border-border focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none"
              rows={2}
              value={caption.text || ''}
              onChange={(e) => updateAnnotation(caption.id, { text: e.target.value })}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
